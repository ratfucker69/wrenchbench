/**
 * Schematic PDF ingestion for WrenchBench.
 *
 * A schematic on the bench is a PDF, and the agent needs to be able to cite
 * it: which page names U7000, which rail a net belongs to. This module pulls
 * the text layer out of a PDF with nothing but Node's zlib:
 *
 *   - every `stream ... endstream` body is located with its dictionary;
 *   - `/FlateDecode` bodies are inflated (tolerantly, so a truncated tail
 *     still yields the readable prefix);
 *   - the content stream is walked for text-showing operators (Tj, TJ, ', ")
 *     and for the positioning operators (Td, TD, T*, Tm, BT/ET) that separate
 *     lines and pages.
 *
 * It is a text-layer reader, not a renderer. A scanned schematic with no text
 * layer produces no characters, and that is reported as such rather than
 * silently returning an empty schematic.
 */

import zlib from 'node:zlib'
import { extractPdfPages } from './pdf-objects.js'

const MAX_STREAMS = 20000
const MAX_TEXT_CHARS = 8_000_000

/** A refdes-shaped token: 1-3 capitals followed by up to 4 digits. */
const REFDES_PATTERN = /\b[A-Z]{1,3}\d{1,4}\b/g
/** Net and rail shapes seen across vendor schematics. */
const NET_PATTERN = /(\+{1,2}\d+[.,]?\d*V\d*[A-Z0-9_]*|\b(?:PP|PV|VCC|VDD|VBAT|VCORE|VPH|VIO|VAUX|VREF|AGND|DGND|PGND|GND)[A-Z0-9_]+\b)/g

/**
 * Read a PDF literal string starting at `(`.
 * @returns {{value: string, next: number}}
 */
function readLiteral(content, start) {
  let i = start + 1
  let depth = 1
  let value = ''
  while (i < content.length) {
    const char = content[i]
    if (char === '\\') {
      const next = content[i + 1]
      if (next === 'n') value += '\n'
      else if (next === 'r') value += '\r'
      else if (next === 't') value += '\t'
      else if (next === 'b') value += '\b'
      else if (next === 'f') value += '\f'
      else if (next === '\n') value += ''
      else if (next >= '0' && next <= '7') {
        let octal = ''
        let j = i + 1
        while (j < content.length && octal.length < 3 && content[j] >= '0' && content[j] <= '7') {
          octal += content[j]
          j += 1
        }
        value += String.fromCharCode(Number.parseInt(octal, 8) & 0xff)
        i = j
        continue
      } else value += next ?? ''
      i += 2
      continue
    }
    if (char === '(') {
      depth += 1
      value += char
      i += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) return { value, next: i + 1 }
      value += char
      i += 1
      continue
    }
    value += char
    i += 1
  }
  return { value, next: content.length }
}

/** Read a PDF hex string starting at `<` (and not `<<`). */
function readHex(content, start) {
  let i = start + 1
  let hex = ''
  while (i < content.length && content[i] !== '>') {
    const char = content[i]
    if (/[0-9A-Fa-f]/.test(char)) hex += char
    i += 1
  }
  if (hex.length % 2 === 1) hex += '0'
  let value = ''
  for (let j = 0; j < hex.length; j += 2) {
    const code = Number.parseInt(hex.slice(j, j + 2), 16)
    if (Number.isFinite(code)) value += String.fromCharCode(code)
  }
  return { value, next: i + 1 }
}

/**
 * Walk one decoded content stream and return its visible text, one line per
 * text-positioning move. Order follows the stream, which for a schematic page
 * is the drawing order the tool used.
 */
function extractStreamText(content) {
  const lines = []
  let current = ''
  let inArray = false

  const flushLine = () => {
    const trimmed = current.replace(/[ \t]+/g, ' ').trim()
    if (trimmed.length > 0) lines.push(trimmed)
    current = ''
  }

  let i = 0
  while (i < content.length) {
    const char = content[i]

    if (char === '(') {
      const { value, next } = readLiteral(content, i)
      current += value
      i = next
      continue
    }

    if (char === '<' && content[i + 1] !== '<') {
      const { value, next } = readHex(content, i)
      current += value
      i = next
      continue
    }

    if (char === '[') {
      inArray = true
      i += 1
      continue
    }
    if (char === ']') {
      inArray = false
      i += 1
      continue
    }

    if (inArray && (char === '-' || (char >= '0' && char <= '9'))) {
      let number = ''
      while (i < content.length && /[-+0-9.]/.test(content[i])) {
        number += content[i]
        i += 1
      }
      const kerning = Number.parseFloat(number)
      // A large negative adjustment is the PDF idiom for an inter-word gap.
      if (Number.isFinite(kerning) && kerning < -180) current += ' '
      continue
    }

    if (char === 'B' && content.startsWith('BT', i)) {
      flushLine()
      i += 2
      continue
    }
    if (char === 'E' && content.startsWith('ET', i)) {
      flushLine()
      i += 2
      continue
    }

    if (char === 'T') {
      const pair = content.slice(i, i + 2)
      if (pair === 'Tj') {
        i += 2
        continue
      }
      if (pair === 'TJ') {
        i += 2
        continue
      }
      if (pair === 'Td' || pair === 'TD') {
        flushLine()
        i += 2
        continue
      }
      if (pair === 'T*') {
        flushLine()
        i += 2
        continue
      }
      if (content.startsWith('Tm', i)) {
        flushLine()
        i += 2
        continue
      }
      if (pair === 'Tf' || pair === 'TL' || pair === 'Tc' || pair === 'Tw' || pair === 'Tz' || pair === 'Ts') {
        i += 2
        continue
      }
    }

    if (char === "'") {
      flushLine()
      i += 1
      continue
    }

    i += 1
  }

  flushLine()
  return lines
}

/** Locate every stream body together with the dictionary that precedes it. */
function findStreams(bytes) {
  const latin = bytes.toString('latin1')
  const streams = []
  const marker = 'stream'
  let searchFrom = 0

  while (streams.length < MAX_STREAMS) {
    const at = latin.indexOf(marker, searchFrom)
    if (at === -1) break
    searchFrom = at + marker.length

    // Reject the `endstream` keyword. Every other occurrence is the stream
    // keyword; a dictionary may close directly onto it (`>>stream`), so the
    // preceding character is not a reliable delimiter.
    if (latin.slice(Math.max(0, at - 3), at) === 'end') continue

    let bodyStart = at + marker.length
    if (latin[bodyStart] === '\r') bodyStart += 1
    if (latin[bodyStart] === '\n') bodyStart += 1

    const end = latin.indexOf('endstream', bodyStart)
    if (end === -1) break
    searchFrom = end + 'endstream'.length

    // A short dictionary window before the keyword carries the filters.
    const dictFrom = Math.max(0, at - 1200)
    const dictionary = latin.slice(dictFrom, at)

    streams.push({
      offset: bodyStart,
      length: Math.max(0, end - bodyStart),
      dictionary,
    })
  }

  return streams
}

function decodeStream(bytes, stream) {
  const body = bytes.subarray(stream.offset, stream.offset + stream.length)
  if (body.length === 0) return null

  const dictionary = stream.dictionary
  const flate = /\/FlateDecode/.test(dictionary)

  if (!flate) {
    // An uncompressed content stream is readable as-is; anything still binary
    // after this point is not a text layer.
    const text = body.toString('latin1')
    return /TV|Tj|TJ|BT/.test(text) ? text : null
  }

  try {
    return zlib.inflateSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1')
  } catch {
    // Truncated or chained streams: keep the readable prefix if any exists.
    try {
      return zlib.inflateRawSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1')
    } catch {
      return null
    }
  }
}

export function tokeniseText(text) {
  const refdes = new Map()
  const nets = new Map()
  for (const match of text.matchAll(REFDES_PATTERN)) {
    refdes.set(match[0], (refdes.get(match[0]) ?? 0) + 1)
  }
  for (const match of text.matchAll(NET_PATTERN)) {
    const name = match[0]
    if (name.length < 3) continue
    nets.set(name, (nets.get(name) ?? 0) + 1)
  }
  const toList = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }))
  return { refdes: toList(refdes, 4000), nets: toList(nets, 4000) }
}

/**
 * Extract the text layer of one PDF.
 *
 * @param {Buffer} bytes raw PDF bytes
 * @param {string} name the filename the PDF arrived under
 * @returns {{name: string, bytes: number, pages: {page: number, text: string}[], text: string, tokens: object, stats: object, pageNumbering: string, warnings: string[]}}
 * @throws {Error} when the payload is not a PDF or carries no text layer
 */
export function extractPdfText(bytes, name) {
  const head = bytes.subarray(0, 1024).toString('latin1')
  if (!head.includes('%PDF')) {
    throw new Error('that file does not start with a PDF header')
  }

  const warnings = []

  // Preferred path: real object/graph parsing with ToUnicode font decoding.
  // Falls back to the raw stream scan for PDFs whose page tree is unreadable.
  let pages = []
  try {
    const parsed = extractPdfPages(bytes)
    warnings.push(...(parsed.warnings ?? []))
    pages = (parsed.pages ?? []).filter((page) => page.text.trim().length > 0)
  } catch (error) {
    warnings.push(`structured parse failed (${error.message}); fell back to a raw stream scan`)
  }

  if (pages.length === 0) {
    const streams = findStreams(bytes)
    if (streams.length === 0) throw new Error('the PDF carries no readable content streams')
    for (const stream of streams) {
      const decoded = decodeStream(bytes, stream)
      if (!decoded) continue
      const lines = extractStreamText(decoded)
      const text = lines.join('\n')
      if (text.trim().length < 8) continue
      pages.push({ page: pages.length + 1, text })
    }
    if (pages.length > 0) warnings.push('text came from a raw stream scan, so page numbers are positional guesses')
  }

  let total = 0
  const limited = []
  for (const page of pages) {
    if (total >= MAX_TEXT_CHARS) {
      warnings.push(`text ceiling reached at ${MAX_TEXT_CHARS} characters; later pages were skipped`)
      break
    }
    limited.push(page)
    total += page.text.length
  }

  if (limited.length === 0) {
    throw new Error(
      'no text layer was found; this looks like a scanned or image-only PDF, which this reader does not OCR',
    )
  }

  const text = limited.map((page) => page.text).join('\n\n')
  return {
    name,
    bytes: bytes.length,
    pages: limited,
    text,
    tokens: tokeniseText(text),
    stats: { pages: limited.length, chars: text.length },
    pageNumbering: 'page-tree',
    warnings,
  }
}

/**
 * Return the pages that contain `query`, with a short window of surrounding
 * text so a citation can be quoted.
 */
export function searchSchematic(schematic, query, limit = 8) {
  const needle = String(query ?? '').trim()
  if (!needle) return []
  const lower = needle.toLowerCase()
  const hits = []

  for (const page of schematic.pages ?? []) {
    const haystack = page.text.toLowerCase()
    let from = 0
    let pageHits = 0
    while (pageHits < 3) {
      const at = haystack.indexOf(lower, from)
      if (at === -1) break
      const start = Math.max(0, at - 110)
      const end = Math.min(page.text.length, at + needle.length + 150)
      hits.push({
        page: page.page,
        snippet: page.text.slice(start, end).replace(/\s+/g, ' ').trim(),
      })
      pageHits += 1
      from = at + lower.length
      if (hits.length >= limit) return hits
    }
  }

  return hits
}

/** The page whose text mentions `token` most often, used for citing a refdes. */
export function pagesForToken(schematic, token, limit = 5) {
  const needle = String(token ?? '').trim()
  if (!needle) return []
  const lower = needle.toLowerCase()
  const scored = []
  for (const page of schematic.pages ?? []) {
    let count = 0
    const haystack = page.text.toLowerCase()
    let at = haystack.indexOf(lower)
    while (at !== -1) {
      count += 1
      at = haystack.indexOf(lower, at + lower.length)
    }
    if (count > 0) scored.push({ page: page.page, count })
  }
  scored.sort((a, b) => b.count - a.count)
  return scored.slice(0, limit)
}
