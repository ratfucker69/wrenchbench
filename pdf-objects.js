/**
 * Minimal PDF text extraction for WrenchBench.
 *
 * A schematic is only useful if its labels come out as *text*. Most board
 * schematics are PDF 1.3/1.4 files whose fonts are subsetted: the bytes in a
 * `Tj` string are glyph indices, not ASCII, so reading a content stream as
 * latin1 yields mojibake. That mojibake is worse than nothing in this plugin,
 * because the agent would happily cite it.
 *
 * So this module does the three things a text layer actually needs:
 *
 *   1. parse the indirect objects and walk the real page tree, so page N is
 *      page N rather than "the Nth stream in the file";
 *   2. read each font's `/ToUnicode` CMap and decode glyph codes through it;
 *   3. reject a page whose decoded output is mostly control bytes, instead of
 *      storing noise and calling it a schematic.
 *
 * It deliberately supports a bounded subset — classic objects, FlateDecode,
 * the standard font dictionaries and ToUnicode. Every unsupported construct is
 * reported as a warning rather than guessed at.
 */

import zlib from 'node:zlib'

/** A page whose decoded text is mostly control bytes is not a text layer. */
const PRINTABLE_FLOOR = 0.85
const MAX_PAGES = 2000

const OBJ_PATTERN = /(\d+)\s+(\d+)\s+obj\b/g

function inflate(body) {
  try {
    return zlib.inflateSync(body)
  } catch {
    try {
      return zlib.inflateSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
    } catch {
      try {
        return zlib.inflateRawSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
      } catch {
        return null
      }
    }
  }
}

/**
 * Index every indirect object by number.
 *
 * Incremental updates append a newer definition of an object, so the last
 * occurrence wins. Compressed object streams (`/ObjStm`) are not read; when a
 * file uses them the caller sees it as missing objects rather than silent
 * nonsense.
 */
function indexObjects(latin1) {
  const objects = new Map()
  OBJ_PATTERN.lastIndex = 0
  let match
  while ((match = OBJ_PATTERN.exec(latin1)) !== null) {
    const number = Number(match[1])
    const bodyStart = match.index + match[0].length
    const endobj = latin1.indexOf('endobj', bodyStart)
    const bodyEnd = endobj === -1 ? latin1.length : endobj
    const body = latin1.slice(bodyStart, bodyEnd)
    const streamAt = body.search(/\bstream\r?\n?/)
    const dict = streamAt === -1 ? body : body.slice(0, streamAt)
    let stream = null
    if (streamAt !== -1) {
      const header = body.slice(streamAt).match(/^\bstream\r?\n?/)
      const dataStart = bodyStart + streamAt + (header ? header[0].length : 6)
      const endstream = latin1.indexOf('endstream', dataStart)
      stream = { start: dataStart, end: endstream === -1 ? bodyEnd : endstream }
    }
    objects.set(number, { number, dict, stream })
  }
  return objects
}

/** Balanced `<< ... >>` starting at `at`, or null. */
function dictAt(text, at) {
  const start = text.indexOf('<<', at)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text.startsWith('<<', i)) {
      depth += 1
      i += 1
    } else if (text.startsWith('>>', i)) {
      depth -= 1
      i += 1
      if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 }
    }
  }
  return null
}

/** First indirect reference `/Key n 0 R` inside a dict string. */
function refOf(dict, key) {
  const match = dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`))
  return match ? Number(match[1]) : null
}

/** All indirect references `/Key [n 0 R m 0 R]`, or the single ref. */
function refsOf(dict, key) {
  const single = refOf(dict, key)
  const arrayMatch = dict.match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`))
  if (!arrayMatch) return single === null ? [] : [single]
  const found = []
  for (const hit of arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)) found.push(Number(hit[1]))
  return found
}

/** An inline dict for a key, e.g. `/Resources << ... >>`. */
function inlineDictOf(dict, key) {
  const at = dict.indexOf(`/${key}`)
  if (at === -1) return null
  const parsed = dictAt(dict, at)
  return parsed ? parsed.text : null
}

function streamTextOf(objects, number) {
  const object = objects.get(number)
  if (!object || !object.stream) return null
  const filter = object.dict.match(/\/Filter\s*\/(\w+)/)
  const plain = object.stream.end >= object.stream.start ? null : null
  void plain
  return { object, filter: filter ? filter[1] : null }
}

/** Decode one stream object to latin1 text, or null when it is not text. */
function decodeObjectStream(objects, number, bytes) {
  const object = objects.get(number)
  if (!object || !object.stream) return null
  const raw = bytes.subarray(object.stream.start, object.stream.end)
  if (raw.length === 0) return null
  if (/\/Subtype\s*\/Image/.test(object.dict)) return null
  if (/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode/.test(object.dict)) return null

  if (/\/FlateDecode/.test(object.dict)) {
    const out = inflate(raw)
    return out ? out.toString('latin1') : null
  }
  if (/\/Filter/.test(object.dict)) return null
  return raw.toString('latin1')
}

// ---------------------------------------------------------------------------
// ToUnicode CMaps
// ---------------------------------------------------------------------------

function hexToUnicode(hex) {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16) || 0)
  // UTF-16BE, including surrogate pairs.
  let out = ''
  for (let i = 0; i + 3 < hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  }
  if (hex.length % 4 === 2) out += String.fromCharCode(parseInt(hex.slice(-2), 16))
  return out
}

/**
 * Parse a ToUnicode CMap into a code→string map.
 *
 * @returns {{width: number, map: Map<number, string>}}
 */
export function parseToUnicode(cmapText) {
  const map = new Map()
  let width = 1

  const space = cmapText.match(/begincodespacerange([\s\S]*?)endcodespacerange/)
  if (space) {
    const first = space[1].match(/<([0-9a-fA-F]+)>/)
    if (first) width = Math.max(1, Math.ceil(first[1].length / 2))
  }

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(pair[1], 16), hexToUnicode(pair[2]))
    }
  }

  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const triple of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([\s\S]*?)\])/g,
    )) {
      const low = parseInt(triple[1], 16)
      const high = parseInt(triple[2], 16)
      if (!Number.isFinite(low) || !Number.isFinite(high) || high < low || high - low > 65535) continue
      if (triple[3] !== undefined) {
        const base = triple[3]
        const width2 = Math.max(2, base.length)
        const startValue = parseInt(base, 16)
        for (let code = low; code <= high; code += 1) {
          const offset = code - low
          map.set(code, hexToUnicode((startValue + offset).toString(16).padStart(width2, '0')))
        }
      } else if (triple[4] !== undefined) {
        const values = [...triple[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((hit) => hexToUnicode(hit[1]))
        values.forEach((value, offset) => {
          if (low + offset <= high) map.set(low + offset, value)
        })
      }
    }
  }

  return { width, map }
}

/** Read a font's decoding table, following /ToUnicode. */
function fontDecoder(objects, bytes, dict) {
  const toUnicode = refOf(dict, 'ToUnicode')
  if (toUnicode !== null) {
    const cmap = decodeObjectStream(objects, toUnicode, bytes)
    if (cmap) {
      const parsed = parseToUnicode(cmap)
      if (parsed.map.size > 0) return { kind: 'cmap', width: parsed.width, map: parsed.map }
    }
  }
  if (/\/WinAnsiEncoding|\/MacRomanEncoding|\/StandardEncoding/.test(dict)) return { kind: 'latin1', width: 1 }
  return { kind: 'unknown', width: 1 }
}

// ---------------------------------------------------------------------------
// Content streams
// ---------------------------------------------------------------------------

const ESCAPE = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }

/** Read a PDF literal string `( ... )` starting at `at`. */
function readLiteralString(text, at) {
  let depth = 0
  let out = ''
  let index = at
  for (; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') {
      const next = text[index + 1]
      if (next === undefined) break
      if (next >= '0' && next <= '7') {
        let octal = ''
        let scan = index + 1
        while (scan < text.length && octal.length < 3 && text[scan] >= '0' && text[scan] <= '7') {
          octal += text[scan]
          scan += 1
        }
        out += String.fromCharCode(parseInt(octal, 8) & 0xff)
        index = scan - 1
        continue
      }
      if (next === '\n') {
        index += 1
        continue
      }
      out += ESCAPE[next] ?? next
      index += 1
      continue
    }
    if (char === '(') {
      if (depth > 0) out += char
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) return { value: out, next: index + 1 }
      out += char
      continue
    }
    out += char
  }
  return { value: out, next: index }
}

function decodeBytes(bytesText, decoder) {
  let out = ''
  if (!decoder || decoder.kind === 'latin1') {
    for (const char of bytesText) out += char
    return out
  }
  if (decoder.kind === 'cmap') {
    const width = decoder.width
    for (let i = 0; i < bytesText.length; i += width) {
      let code = 0
      for (let j = 0; j < width; j += 1) code = (code << 8) | (bytesText.charCodeAt(i + j) & 0xff)
      const mapped = decoder.map.get(code)
      if (mapped !== undefined) out += mapped
      else if (width === 1) out += bytesText[i]
    }
    return out
  }
  return ''
}

/**
 * Pull the visible text out of one content stream.
 *
 * This is a tokeniser, not an interpreter: it tracks the current font, reads
 * the string operands of `Tj`/`TJ`/`'`/`"`, and starts a new line on the
 * positioning operators. Curves, colours and clipping are skipped, which is
 * exactly what a schematic label extraction needs.
 */
function contentStreamText(content, fonts) {
  let decoder = null
  let out = ''
  const operands = []
  let index = 0

  const newline = () => {
    if (out.length > 0 && !out.endsWith('\n')) out += '\n'
  }

  while (index < content.length) {
    const char = content[index]

    if (char === '%') {
      while (index < content.length && content[index] !== '\n' && content[index] !== '\r') index += 1
      continue
    }

    if (char === '(') {
      const literal = readLiteralString(content, index)
      operands.push({ kind: 'string', value: literal.value })
      index = literal.next
      continue
    }

    if (char === '<' && content[index + 1] !== '<') {
      const close = content.indexOf('>', index)
      if (close === -1) break
      const hex = content.slice(index + 1, close).replace(/[^0-9a-fA-F]/g, '')
      let bytesText = ''
      for (let i = 0; i + 1 < hex.length; i += 2) bytesText += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      operands.push({ kind: 'string', value: bytesText })
      index = close + 1
      continue
    }

    if (char === '[' || char === ']') {
      if (char === '[') operands.push({ kind: 'array', value: [] })
      index += 1
      continue
    }

    if (char === '/') {
      let end = index + 1
      while (end < content.length && !/[\s/[\]<>()%{}]/.test(content[end])) end += 1
      operands.push({ kind: 'name', value: content.slice(index + 1, end) })
      index = end
      continue
    }

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    // Operator or number
    let end = index
    while (end < content.length && !/[\s/[\]<>()%{}]/.test(content[end])) end += 1
    if (end === index) {
      index += 1
      continue
    }
    const token = content.slice(index, end)
    index = end

    if (/^[-+.\d]+$/.test(token)) {
      operands.push({ kind: 'number', value: Number(token) })
      continue
    }

    switch (token) {
      case 'Tf': {
        const name = [...operands].reverse().find((item) => item.kind === 'name')
        if (name) decoder = fonts.get(name.value) ?? null
        break
      }
      case 'Tj':
      case "'":
      case '"': {
        if (token !== 'Tj') newline()
        const string = [...operands].reverse().find((item) => item.kind === 'string')
        if (string) out += decodeBytes(string.value, decoder)
        break
      }
      case 'TJ': {
        const array = [...operands].reverse().find((item) => item.kind === 'array')
        if (array) {
          const strings = []
          for (let i = 0; i < array.value.length; i += 1) {
            const item = array.value[i]
            if (item && item.kind === 'string') strings.push(decodeBytes(item.value, decoder))
            else if (item && item.kind === 'number' && item.value < -180) strings.push(' ')
          }
          out += strings.join('')
        }
        break
      }
      case 'Td':
      case 'TD':
      case 'T*':
        newline()
        break
      case 'Tm':
        newline()
        break
      case 'ET':
        newline()
        break
      default:
        break
    }
    operands.length = 0
  }

  return out
}

/** Collapse control bytes and stray whitespace; report how printable it is. */
function tidy(text) {
  const stripped = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
  const printable = stripped.replace(/[^\x20-\x7e\u00a0-\uffff\n]/g, '')
  const ratio = stripped.length === 0 ? 0 : printable.length / stripped.length
  const cleaned = printable
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, position, all) => line.length > 0 || (position > 0 && all[position - 1] !== ''))
    .join('\n')
    .trim()
  return { text: cleaned, ratio }
}

// ---------------------------------------------------------------------------
// Page tree
// ---------------------------------------------------------------------------

function collectPages(objects, startNumber, inherited, depth = 0) {
  const pages = []
  if (depth > 64 || startNumber === null || startNumber === undefined) return pages
  const object = objects.get(startNumber)
  if (!object) return pages

  const resources = inlineDictOf(object.dict, 'Resources') ?? inherited.resources ?? null
  if (/\/Type\s*\/Pages\b/.test(object.dict) || /\/Kids\s*\[/.test(object.dict)) {
    const kids = object.dict.match(/\/Kids\s*\[([\s\S]*?)\]/)
    if (kids) {
      for (const hit of kids[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
        pages.push(...collectPages(objects, Number(hit[1]), { resources }, depth + 1))
      }
    }
    return pages
  }

  if (/\/Type\s*\/Page\b/.test(object.dict)) {
    pages.push({ object: object.number, dict: object.dict, resources })
  }
  return pages
}

function findCatalog(objects) {
  for (const object of objects.values()) {
    if (/\/Type\s*\/Catalog/.test(object.dict)) return object
  }
  return null
}

function resourceDictText(objects, resourcesText) {
  if (!resourcesText) return null
  const direct = resourcesText.match(/\/Resources\s*<<([\s\S]*?)>>/)
  if (direct) return direct[1]
  return resourcesText
}

function buildFontMap(objects, bytes, resourcesText) {
  const fonts = new Map()
  const text = resourceDictText(objects, resourcesText)
  if (!text) return fonts
  const fontBlock = text.match(/\/Font\s*<<([\s\S]*?)>>/)
  if (!fontBlock) {
    const fontRef = refOf(text, 'Font')
    if (fontRef === null) return fonts
    const object = objects.get(fontRef)
    if (!object) return fonts
    for (const hit of object.dict.matchAll(/\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fontObject = objects.get(Number(hit[2]))
      if (fontObject) fonts.set(hit[1], fontDecoder(objects, bytes, fontObject.dict))
    }
    return fonts
  }
  for (const hit of fontBlock[1].matchAll(/\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const fontObject = objects.get(Number(hit[2]))
    if (fontObject) fonts.set(hit[1], fontDecoder(objects, bytes, fontObject.dict))
  }
  return fonts
}

/**
 * Extract the text layer of a PDF, page by page and in page order.
 *
 * @param {Buffer} bytes raw PDF bytes
 * @returns {{pages: {page: number, text: string}[], warnings: string[], pageCount: number, engine: string}}
 */
export function extractPdfPages(bytes) {
  const latin1 = bytes.toString('latin1')
  const objects = indexObjects(latin1)
  const warnings = []
  if (objects.size === 0) return { pages: [], warnings: ['no indirect objects could be read'], pageCount: 0, engine: 'objects' }

  let tree = []
  const catalog = findCatalog(objects)
  const pagesRef = catalog ? refOf(catalog.dict, 'Pages') : null
  if (pagesRef !== null) tree = collectPages(objects, pagesRef, {})
  if (tree.length === 0) {
    // No usable page tree (damaged xref, or objects in an unsupported order):
    // fall back to every /Type /Page object in file order.
    for (const object of objects.values()) {
      if (/\/Type\s*\/Page\b/.test(object.dict)) tree.push({ object: object.number, dict: object.dict, resources: null })
    }
    if (tree.length > 0) warnings.push('page tree was unreadable; pages were taken in file order')
  }
  if (tree.length === 0) return { pages: [], warnings: ['no page objects were found'], pageCount: 0, engine: 'objects' }
  if (tree.length > MAX_PAGES) {
    warnings.push(`the PDF declares ${tree.length} pages; only the first ${MAX_PAGES} were read`)
    tree = tree.slice(0, MAX_PAGES)
  }

  const pages = []
  let unreadable = 0
  for (let index = 0; index < tree.length; index += 1) {
    const entry = tree[index]
    const fonts = buildFontMap(objects, bytes, entry.resources ?? inlineDictOf(entry.dict, 'Resources'))
    const contents = refsOf(entry.dict, 'Contents')
    let raw = ''
    for (const ref of contents) raw += `${decodeObjectStream(objects, ref, bytes) ?? ''}\n`
    if (raw.length === 0) {
      const inline = entry.dict.match(/\/Contents\s*\(([\s\S]*?)\)/)
      if (inline) raw = inline[1]
    }
    const extracted = contentStreamText(raw, fonts)
    const { text, ratio } = tidy(extracted)
    // A page that drew *something* but decoded to almost nothing printable is
    // a font we could not map. Storing it would let the agent cite noise.
    if (extracted.length > 0 && (ratio < PRINTABLE_FLOOR || text.length === 0)) {
      unreadable += 1
      pages.push({ page: index + 1, text: '' })
      continue
    }
    pages.push({ page: index + 1, text })
  }

  if (unreadable > 0) {
    warnings.push(
      `${unreadable} page(s) decoded to non-text output and were left empty (subset fonts without a ToUnicode map)`,
    )
  }

  return { pages, warnings, pageCount: pages.length, engine: 'objects' }
}

/** Cheap structural probe used to decide whether a PDF is worth parsing. */
export function pdfLooksTextual(bytes) {
  const head = bytes.subarray(0, Math.min(bytes.length, 262144)).toString('latin1')
  if (!head.includes('%PDF')) return false
  return /\/Font|\/ToUnicode/.test(bytes.toString('latin1'))
}
