/**
 * Schematic ingestion for WrenchBench.
 *
 * A technician's "schematic" is whatever the repair forum handed them: a PDF
 * with a text layer, a PDF that is really a scan, a CSV bill of materials, a
 * KiCad `.sch` text file, or a zip holding several of those. Refusing the file
 * because of its extension is the wrong behaviour — the useful question is
 * "does this payload carry readable text?", and every answer here is reported
 * plainly rather than papered over.
 *
 * Order of preference:
 *   1. PDF  — parsed for its text layer with font decoding (pdf-objects.js);
 *   2. ZIP  — the best readable member is used, so a bundled drop works;
 *   3. text — indexed directly, paged on form feeds or size;
 *   4. image — accepted as *not* indexable, with the reason and a next step.
 */

import { extractPdfText, tokeniseText } from './pdf-text.js'
import { isZip, extractZip } from './zip.js'

/** A page of text, before it becomes a searchable schematic. */
const CHUNK_CHARS = 24000
const MAX_TEXT_CHARS = 6 * 1024 * 1024

function printableRatio(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 65536))
  if (sample.length === 0) return 0
  let printable = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80) printable += 1
  }
  return printable / sample.length
}

function looksLikeImage(bytes) {
  if (bytes.length < 8) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'JPEG'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'GIF'
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'WebP'
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) return 'TIFF'
  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a) return 'TIFF'
  return null
}

/** Paged text schematic built from a plain-text payload. */
function fromText(text, name, extraWarnings = []) {
  const cleaned = text.replace(/\r\n?/g, '\n')
  const pages = []
  const formFeeds = cleaned.split('\f')
  const source = formFeeds.length > 1 ? formFeeds : null

  if (source) {
    source.forEach((chunk, index) => {
      const body = chunk.trim()
      if (body.length === 0) return
      pages.push({ page: pages.length + 1, text: body })
    })
  } else {
    let cursor = 0
    while (cursor < cleaned.length && pages.length < 500) {
      let end = Math.min(cleaned.length, cursor + CHUNK_CHARS)
      if (end < cleaned.length) {
        const newline = cleaned.lastIndexOf('\n', end)
        if (newline > cursor) end = newline
      }
      const body = cleaned.slice(cursor, end).trim()
      if (body.length > 0) pages.push({ page: pages.length + 1, text: body })
      cursor = end
    }
  }

  const kept = pages.filter((page) => page.text.length > 0)
  if (kept.length === 0) throw new Error('that file has no readable text')
  let total = 0
  const limited = []
  for (const page of kept) {
    if (total >= MAX_TEXT_CHARS) break
    limited.push(page)
    total += page.text.length
  }

  const joined = limited.map((page) => page.text).join('\n\n')
  return {
    name,
    bytes: Buffer.byteLength(text, 'utf8'),
    pages: limited,
    text: joined,
    tokens: tokeniseText(joined),
    stats: { pages: limited.length, chars: joined.length },
    pageNumbering: source ? 'form-feed' : 'text-chunk',
    warnings: [
      ...extraWarnings,
      source
        ? 'indexed as plain text, paged on form feeds'
        : 'indexed as plain text; page numbers are position-based chunks, not printed page numbers',
    ],
  }
}

function unwrapArchive(bytes, name) {
  const pdfs = []
  const texts = []
  const { files, warnings, skipped } = extractZip(bytes, {
    want: (entryName) => /\.(pdf|txt|csv|tsv|sch|asc|net|bom|md|log)$/i.test(entryName) || entryName.toLowerCase().includes('schem'),
  })
  for (const file of files) {
    if (file.data.subarray(0, 1024).toString('latin1').includes('%PDF')) pdfs.push(file)
    else texts.push(file)
  }
  const notes = [...warnings]
  for (const entry of skipped) notes.push(`${entry.name}: ${entry.reason}`)
  if (pdfs.length === 0 && texts.length === 0) {
    throw new Error('that archive holds no PDF or text schematic (images and CAD binaries are not indexable here)')
  }
  return { pdf: pdfs[0] ?? null, text: texts[0] ?? null, notes }
}

/**
 * Extract a searchable schematic from any payload.
 *
 * @param {Buffer} bytes the uploaded file, whatever it is
 * @param {string} name the filename it arrived under
 * @returns {object} the same shape `extractPdfText` returns
 * @throws {Error} with a plain reason when nothing indexable is inside
 */
export function extractSchematic(bytes, name) {
  if (bytes.length === 0) throw new Error('the upload was empty')

  // 1. A PDF, whatever it is called.
  if (bytes.subarray(0, 1024).toString('latin1').includes('%PDF')) {
    return extractPdfText(bytes, name)
  }

  // 2. An archive holding one (or holding text).
  if (isZip(bytes)) {
    const { pdf, text, notes } = unwrapArchive(bytes, name)
    const label = pdf ? pdf.name : text.name
    if (pdf) {
      const schematic = extractPdfText(pdf.data, label)
      return { ...schematic, warnings: [...notes, ...(schematic.warnings ?? [])] }
    }
    return fromText(text.data.toString('utf8'), label, notes)
  }

  // 3. A scan or a photo: honest refusal, with the next step.
  const image = looksLikeImage(bytes)
  if (image) {
    throw new Error(
      `that is a ${image} image, not a text-searchable schematic. WrenchBench does not OCR images; supply the PDF with a text layer, or an exported BOM/CSV, and the schematic search works.`,
    )
  }

  // 4. Anything textual — a BOM, a KiCad sheet, a netlist dump.
  if (printableRatio(bytes) > 0.85) {
    return fromText(bytes.toString('utf8'), name)
  }

  const head = [...bytes.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
  throw new Error(
    `no readable schematic text in this file (first bytes ${head}). PDF, plain text, CSV/BOM or a zip of those all work; images and CAD binaries do not.`,
  )
}
