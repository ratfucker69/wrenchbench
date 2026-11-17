/**
 * Boardview parsers for WrenchBench.
 *
 * Two families are read here:
 *
 *  1. The "Test_Link shape" ASCII family. Several vendor boardview formats
 *     share one layout: a four-integer count header, then an outline block,
 *     a parts block, a pins block and a nails block. Each dialect swaps the
 *     block marker spellings but keeps the line grammar. Formats in this
 *     family: .brd .brd2 .bv .gr .cad .cst .f2b .asc .pcb .bvr .tvw .bdv .fz
 *     (the last three ship packed binary in the wild, so a zlib pass runs
 *     first when the payload is not printable).
 *
 *  2. KiCad `.kicad_pcb`, which is an s-expression document: footprints with
 *     relative pad coordinates, absolute placement in millimetres, and an
 *     Edge.Cuts layer carrying the board outline.
 *
 * The model this module returns is what both the canvas and the agent tools
 * read, so a number the agent quotes is a number the canvas drew.
 */

import zlib from 'node:zlib'

import { isXZZ, parseXZZ, XzzParseError } from './xzz.js'
import { classifyParts } from './naming.js'
import { isZip, extractZip } from './zip.js'

export const SUPPORTED_EXTENSIONS = [
  '.brd',
  '.brd2',
  '.fz',
  '.tvw',
  '.cad',
  '.pcb',
  '.bdv',
  '.asc',
  '.bv',
  '.bvr',
  '.gr',
  '.cst',
  '.f2b',
  '.kicad_pcb',
]

/** Ceilings that keep a hostile or mislabelled file from exhausting the Host. */
const MAX_PARTS = 200000
const MAX_PINS = 4000000
const MAX_NAILS = 4000000

/**
 * A parse failure that carries a reason a technician can act on.
 */
export class BoardParseError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'BoardParseError'
    this.reason = details.reason ?? 'unreadable'
    this.hint = details.hint
  }
}

// ---------------------------------------------------------------------------
// Marker vocabulary
// ---------------------------------------------------------------------------

/**
 * Block markers, most specific first. `Pins1:` is the parts block in the
 * OpenBoardView-era dialects while `Pins:` is the pin block, so ordering
 * matters: a line is classified by the first marker it starts with.
 */
const MARKER_TABLE = [
  ['parts', ['Pins1:', '[Pins1]', 'Parts:', '[Parts]', 'Components:', '[Components]']],
  ['pins', ['Pins2:', '[Pins2]', 'Pins:', '[Pins]']],
  ['nails', ['Nails:', '[Nails]']],
  ['outline', ['Format:', '[Format]', 'Outline:', '[Outline]', 'Board:', '[Board]']],
]

const HEADER_MARKER = 'var_data:'

/** A bracketed `[Something]` line always closes the block it appears in. */
const BRACKET_MARKER = /^\[[A-Za-z0-9_ ]+\]$/

/** Any `Word:` line that is not a value line closes a block defensively. */
const GENERIC_MARKER = /^[A-Za-z_][A-Za-z0-9_ ]{0,24}:\s*$/

function classifyMarker(line) {
  for (const [kind, markers] of MARKER_TABLE) {
    for (const marker of markers) {
      if (line.startsWith(marker)) return kind
    }
  }
  return null
}

function isAnyMarker(line) {
  if (classifyMarker(line)) return true
  if (line.startsWith(HEADER_MARKER)) return true
  return BRACKET_MARKER.test(line) || GENERIC_MARKER.test(line)
}

function nonEmptyLines(text) {
  return text.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line.length > 0)
}

function findMarker(lines, kind) {
  for (let i = 0; i < lines.length; i += 1) {
    if (classifyMarker(lines[i]) === kind) return i
  }
  return -1
}

function readBlock(lines, startIndex, count) {
  const out = []
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (isAnyMarker(line)) break
    out.push(line)
    if (count != null && out.length >= count) break
  }
  return out
}

function headerCounts(lines) {
  for (const line of lines) {
    if (!line.startsWith(HEADER_MARKER)) continue
    const tokens = line.slice(HEADER_MARKER.length).trim().split(/\s+/)
    if (tokens.length < 4) return null
    const values = tokens.slice(0, 4).map((token) => Number.parseInt(token, 10))
    if (values.some((value) => !Number.isFinite(value))) return null
    return {
      outline: Math.max(0, values[0]),
      parts: Math.max(0, values[1]),
      pins: Math.max(0, values[2]),
      nails: Math.max(0, values[3]),
    }
  }
  return null
}

function intOf(token) {
  const value = Number.parseInt(token, 10)
  return Number.isFinite(value) ? value : null
}

// ---------------------------------------------------------------------------
// Test_Link shape
// ---------------------------------------------------------------------------

function parseTestLinkShape(text) {
  const lines = nonEmptyLines(text)
  if (lines.length === 0) throw new BoardParseError('the file is empty', { reason: 'empty' })

  const counts = headerCounts(lines)
  const hasBlock = MARKER_TABLE.some(([, markers]) => markers.some((marker) => lines.some((line) => line.startsWith(marker))))
  if (!hasBlock && !counts) {
    throw new BoardParseError('no recognizable boardview block markers were found', {
      reason: 'no-markers',
      hint:
        'This looks like a binary or vendor-specific container. Packed .tvw/.bdv/.fz files are read through their zlib payload; anything else needs a converter.',
    })
  }

  // --- outline -------------------------------------------------------------
  const outline = []
  const outlineIndex = findMarker(lines, 'outline')
  if (outlineIndex !== -1) {
    for (const line of readBlock(lines, outlineIndex, counts?.outline ?? null)) {
      const tokens = line.split(/\s+/)
      const x = intOf(tokens[0])
      const y = intOf(tokens[1])
      if (x === null || y === null) continue
      outline.push({ x, y })
    }
  }

  // --- parts ---------------------------------------------------------------
  const rawParts = []
  const partsIndex = findMarker(lines, 'parts')
  if (partsIndex !== -1) {
    const body = readBlock(lines, partsIndex, counts?.parts ?? null)
    if (body.length > MAX_PARTS) throw new BoardParseError('too many components for one board', { reason: 'too-large' })
    for (const line of body) {
      const tokens = line.split(/\s+/)
      if (tokens.length < 3) continue
      const layerBits = intOf(tokens[1])
      const endOfPins = intOf(tokens[2])
      if (layerBits === null || endOfPins === null) continue
      rawParts.push({ refdes: tokens[0], layerBits, endOfPins })
    }
  }

  // --- pins ----------------------------------------------------------------
  const pins = []
  const pinsIndex = findMarker(lines, 'pins')
  if (pinsIndex !== -1 && rawParts.length > 0) {
    const body = readBlock(lines, pinsIndex, counts?.pins ?? null)
    if (body.length > MAX_PINS) throw new BoardParseError('too many pads for one board', { reason: 'too-large' })
    const counters = new Array(rawParts.length).fill(0)
    for (const line of body) {
      const tokens = line.split(/\s+/)
      if (tokens.length < 4) continue
      const x = intOf(tokens[0])
      const y = intOf(tokens[1])
      const probe = intOf(tokens[2])
      const partIndex = intOf(tokens[3])
      if (x === null || y === null || partIndex === null) continue
      if (partIndex < 1 || partIndex > rawParts.length) continue
      const owner = partIndex - 1
      counters[owner] += 1
      const netToken = tokens.length >= 5 ? tokens.slice(4).join(' ') : ''
      pins.push({
        x,
        y,
        probe: probe === -99 ? null : probe,
        part: owner,
        index: counters[owner],
        net: netToken.length > 0 ? netToken : null,
        layer: rawParts[owner].layerBits & 0x2 ? 'bottom' : 'top',
      })
    }
  }

  // --- nails (probe points) ------------------------------------------------
  const nails = []
  const nailsIndex = findMarker(lines, 'nails')
  if (nailsIndex !== -1) {
    for (const line of readBlock(lines, nailsIndex, counts?.nails ?? null)) {
      const tokens = line.split(/\s+/)
      if (tokens.length < 5) continue
      const probe = intOf(tokens[0])
      const x = intOf(tokens[1])
      const y = intOf(tokens[2])
      const side = intOf(tokens[3])
      if (probe === null || x === null || y === null) continue
      nails.push({ probe, x, y, side: side === 1 ? 'top' : 'bottom', net: tokens.slice(4).join(' ') })
      if (nails.length > MAX_NAILS) break
    }
  }

  if (rawParts.length === 0 && pins.length === 0) {
    throw new BoardParseError('the parts and pads blocks were both empty', {
      reason: 'empty-board',
      hint: 'The block markers were found but carried no component lines.',
    })
  }

  // Nets can live only in the nails block in some dialects; backfill by probe.
  if (nails.length > 0) {
    const byProbe = new Map()
    for (const nail of nails) if (nail.net) byProbe.set(nail.probe, nail.net)
    for (const pin of pins) {
      if (pin.net === null && pin.probe !== null && byProbe.has(pin.probe)) pin.net = byProbe.get(pin.probe)
    }
  }

  const parts = rawParts.map((raw, index) => {
    const own = pins.filter((pin) => pin.part === index)
    const bbox = own.length
      ? {
          x1: Math.min(...own.map((pin) => pin.x)),
          y1: Math.min(...own.map((pin) => pin.y)),
          x2: Math.max(...own.map((pin) => pin.x)),
          y2: Math.max(...own.map((pin) => pin.y)),
        }
      : { x1: 0, y1: 0, x2: 0, y2: 0 }
    return {
      refdes: raw.refdes,
      layer: raw.layerBits & 0x2 ? 'bottom' : 'top',
      smd: Boolean(raw.layerBits & 0x4),
      pins: own.length,
      bbox,
    }
  })

  return {
    format: 'test-link',
    units: 'unit',
    outline,
    edges: [],
    parts,
    pins,
    nails,
    warnings: [],
  }
}

// ---------------------------------------------------------------------------
// KiCad .kicad_pcb
// ---------------------------------------------------------------------------

/**
 * Minimal s-expression reader. Returns nodes of `{ name, args, children }`,
 * where `args` holds bare atoms and quoted strings and `children` holds
 * nested lists. Strings keep their decoded text without the quotes.
 */
function readSExpressions(text) {
  const root = { name: '#root', args: [], children: [] }
  const stack = [root]
  let i = 0
  const length = text.length

  while (i < length) {
    const char = text[i]
    if (char === '(') {
      const node = { name: '', args: [], children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
      i += 1
      continue
    }
    if (char === ')') {
      if (stack.length > 1) stack.pop()
      i += 1
      continue
    }
    if (char === '"') {
      let value = ''
      i += 1
      while (i < length) {
        const c = text[i]
        if (c === '\\' && i + 1 < length) {
          const next = text[i + 1]
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
          continue
        }
        if (c === '"') {
          i += 1
          break
        }
        value += c
        i += 1
      }
      const top = stack[stack.length - 1]
      if (top.name === '' && top.args.length === 0 && top.children.length === 0) top.name = value
      else top.args.push(value)
      continue
    }
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    let atom = ''
    while (i < length && !/[\s()"]/.test(text[i])) {
      atom += text[i]
      i += 1
    }
    const top = stack[stack.length - 1]
    if (top.name === '' && top.args.length === 0 && top.children.length === 0) top.name = atom
    else top.args.push(atom)
  }

  return root
}

function child(node, name) {
  return node.children.find((entry) => entry.name === name)
}

function childrenOf(node, name) {
  return node.children.filter((entry) => entry.name === name)
}

function numericArgs(node) {
  if (!node) return []
  return node.args.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value))
}

function rotate(x, y, degrees) {
  if (!degrees) return { x, y }
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function parseKiCad(text) {
  const root = readSExpressions(text)
  const pcb = child(root, 'kicad_pcb') ?? root
  const parts = []
  const pins = []
  const edges = []
  const warnings = []

  // Board edge: every Edge.Cuts primitive contributes a segment.
  const collectEdge = (node) => {
    const layer = child(node, 'layer')
    if (!layer || layer.args[0] !== 'Edge.Cuts') return
    if (node.name === 'gr_line' || node.name === 'gr_arc') {
      const start = numericArgs(child(node, 'start'))
      const end = numericArgs(child(node, 'end'))
      if (start.length >= 2 && end.length >= 2) edges.push({ x1: start[0], y1: start[1], x2: end[0], y2: end[1] })
      return
    }
    if (node.name === 'gr_rect') {
      const start = numericArgs(child(node, 'start'))
      const end = numericArgs(child(node, 'end'))
      if (start.length < 2 || end.length < 2) return
      const [x1, y1] = start
      const [x2, y2] = end
      edges.push({ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2 }, { x1, y1: y2, x2: x1, y2 })
    }
  }

  for (const node of pcb.children) {
    collectEdge(node)
    if (node.name !== 'footprint' && node.name !== 'module') continue
    if (parts.length >= MAX_PARTS) {
      warnings.push('component ceiling reached; the board was cut short')
      break
    }

    const layerNode = child(node, 'layer')
    const layer = layerNode?.args[0] === 'B.Cu' ? 'bottom' : 'top'
    const at = numericArgs(child(node, 'at'))
    const originX = at[0] ?? 0
    const originY = at[1] ?? 0
    const originAngle = at[2] ?? 0

    let refdes = ''
    for (const textNode of childrenOf(node, 'fp_text')) {
      if (textNode.args[0] === 'reference') {
        refdes = textNode.args[1] ?? ''
        break
      }
    }
    if (!refdes) {
      const property = childrenOf(node, 'property').find((entry) => entry.args[0] === 'Reference')
      refdes = property?.args[1] ?? ''
    }
    if (!refdes) refdes = node.args[0] ?? `#${parts.length + 1}`

    const partIndex = parts.length
    const padNodes = childrenOf(node, 'pad')
    let smd = false
    let pinCount = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const pad of padNodes) {
      if (padsTooMany(pins)) break
      const type = pad.args[1]
      if (type === 'smd') smd = true
      const padAt = numericArgs(child(pad, 'at'))
      if (padAt.length < 2) continue
      const local = rotate(padAt[0], padAt[1], originAngle)
      const x = originX + local.x
      const y = originY + local.y
      const netNode = child(pad, 'net')
      const net = netNode ? (netNode.args[1] ?? netNode.args[0] ?? null) : null
      pinCount += 1
      pins.push({ x, y, probe: null, part: partIndex, index: pinCount, net, layer })
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }

    parts.push({
      refdes,
      layer,
      smd,
      pins: pinCount,
      bbox:
        pinCount > 0
          ? { x1: minX, y1: minY, x2: maxX, y2: maxY }
          : { x1: originX, y1: originY, x2: originX, y2: originY },
    })
  }

  if (parts.length === 0) {
    throw new BoardParseError('no footprint blocks were found in the KiCad board', { reason: 'empty-board' })
  }

  return {
    format: 'kicad_pcb',
    units: 'mm',
    outline: [],
    edges,
    parts,
    pins,
    nails: [],
    warnings,
  }
}

function padsTooMany(pins) {
  return pins.length >= MAX_PINS
}

// ---------------------------------------------------------------------------
// Binary container recovery
// ---------------------------------------------------------------------------

function printableRatio(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048))
  if (sample.length === 0) return 0
  let printable = 0
  for (const byte of sample) {
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) printable += 1
  }
  return printable / sample.length
}

function looksBinary(bytes) {
  return printableRatio(bytes) < 0.7
}

/**
 * Packed boardview containers are usually one or more zlib streams. Rather than
 * guess the container header, try the whole payload and then every plausible
 * zlib offset, and keep the first inflate that yields boardview markers.
 */
function inflateBoardview(bytes) {
  const attempts = []
  const tryInflate = (slice) => {
    try {
      return zlib.inflateSync(slice)
    } catch {
      return null
    }
  }

  const whole = tryInflate(bytes)
  if (whole) attempts.push(whole)

  const limit = Math.min(bytes.length - 2, 65536)
  for (let offset = 0; offset < limit; offset += 1) {
    const marker = bytes[offset]
    // zlib CMF for deflate with a 32K window is 0x78.
    if (marker !== 0x78) continue
    const inflated = tryInflate(bytes.subarray(offset))
    if (inflated && inflated.length > 256) attempts.push(inflated)
    if (attempts.length >= 4) break
  }

  let best = null
  let bestScore = 0
  for (const candidate of attempts) {
    const text = candidate.toString('latin1')
    const score = MARKER_TABLE.reduce((total, [, markers]) => total + markers.filter((marker) => text.includes(marker)).length, 0)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return bestScore > 0 ? best : null
}

// ---------------------------------------------------------------------------
// Nets and summary
// ---------------------------------------------------------------------------

const POWER_PATTERN = /^(\+?\d+V\d*(_[A-Z0-9_]+)?|VCC[A-Z0-9_]*|VDD[A-Z0-9_]*|V_[A-Z0-9_]+)$/i
const GROUND_PATTERN = /^(GND|GROUND|VSS|AGND|DGND|PGND)$/i
const RAIL_LIKE = /^(\+|-)?\d+([.,]\d+)?\s*V/i

/** Group pins by net name and flag rails and ground planes. */
export function deriveNets(pins) {
  const byName = new Map()
  for (let index = 0; index < pins.length; index += 1) {
    const name = pins[index].net
    if (!name) continue
    let bucket = byName.get(name)
    if (!bucket) {
      bucket = []
      byName.set(name, bucket)
    }
    bucket.push(index)
  }

  const nets = []
  for (const [name, indices] of byName) {
    nets.push({
      name,
      pins: indices,
      power: POWER_PATTERN.test(name) || RAIL_LIKE.test(name),
      ground: GROUND_PATTERN.test(name),
    })
  }
  nets.sort((a, b) => b.pins.length - a.pins.length || a.name.localeCompare(b.name))
  return nets
}

function boundsOf(points, edges) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const consider = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const point of points) consider(point.x, point.y)
  for (const edge of edges ?? []) {
    consider(edge.x1, edge.y1)
    consider(edge.x2, edge.y2)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  if (maxX === minX) maxX = minX + 1
  if (maxY === minY) maxY = minY + 1
  return { minX, minY, maxX, maxY }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse one boardview payload into the shared board model.
 *
 * @param {Buffer|Uint8Array} input raw file bytes
 * @param {string} filename the name the file arrived under, used for the extension
 * @returns {{format: string, units: string, outline: object[], edges: object[], parts: object[], pins: object[], nails: object[], nets: object[], bounds: object, warnings: string[]}}
 * @throws {BoardParseError} when the payload cannot be read as a board
 */
export function parseBoard(input, filename) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (bytes.length === 0) throw new BoardParseError('the file is empty', { reason: 'empty' })

  // A boardview often arrives inside an archive. Unpack first, then read the
  // member that is actually a board, so the extension of the outer file — or of
  // the member — never decides whether an import works.
  if (isZip(bytes)) {
    const { files, warnings: zipWarnings, skipped } = extractZip(bytes)
    if (files.length === 0) {
      throw new BoardParseError('that archive holds no readable file', {
        reason: 'archive',
        hint: skipped.length ? skipped.map((entry) => `${entry.name}: ${entry.reason}`).join('; ') : undefined,
      })
    }
    // Prefer the largest member: a boardview is much bigger than a readme.
    const ordered = [...files].sort((a, b) => b.data.length - a.data.length)
    const failures = []
    for (const file of ordered) {
      try {
        const parsed = parseBoard(file.data, file.name)
        parsed.warnings = [
          ...zipWarnings,
          `board read from ${file.name} inside the archive`,
          ...(parsed.warnings ?? []),
        ]
        return parsed
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new BoardParseError('no member of that archive could be read as a board', {
      reason: 'archive',
      hint: failures.slice(0, 6).join('; '),
    })
  }

  // The XZZ container is identified by its signature, not its extension, and
  // needs its own reader: only its part blocks are DES-encrypted.
  if (isXZZ(bytes)) {
    let parsed
    try {
      parsed = parseXZZ(bytes)
    } catch (error) {
      if (error instanceof XzzParseError) {
        throw new BoardParseError(error.message, { reason: 'xzz' })
      }
      throw error
    }
    const nets = deriveNets(parsed.pins)
    const bounds = boundsOf(parsed.outline.length > 0 ? parsed.outline : parsed.pins, parsed.edges)
    const roles = classifyParts(parsed.parts)
    return {
      ...parsed,
      nets,
      bounds,
      stats: {
        parts: parsed.parts.length,
        components: roles.components,
        padEntries: roles.pads,
        unnamedParts: roles.unnamed,
        pins: parsed.pins.length,
        nets: nets.length,
        probes: parsed.nails.length,
        layers: parsed.parts.some((part) => part.layer === 'bottom') ? 2 : 1,
      },
    }
  }

  const extension = (filename.match(/\.[A-Za-z0-9_]+$/) ?? [''])[0].toLowerCase()
  const text = bytes.toString('utf8')

  const isKiCad = extension === '.kicad_pcb' || text.slice(0, 4096).includes('(kicad_pcb')
  const parsed = isKiCad ? parseKiCad(text) : parseAsciiFamily(bytes, text)

  const nets = deriveNets(parsed.pins)
  const bounds = boundsOf(
    parsed.outline.length > 0 ? parsed.outline : parsed.pins,
    parsed.edges,
  )

  const roles = classifyParts(parsed.parts)
  return {
    ...parsed,
    nets,
    bounds,
    stats: {
      parts: parsed.parts.length,
      components: roles.components,
      padEntries: roles.pads,
      unnamedParts: roles.unnamed,
      pins: parsed.pins.length,
      nets: nets.length,
      probes: parsed.nails.length,
      layers: parsed.parts.some((part) => part.layer === 'bottom') ? 2 : 1,
    },
  }
}

function parseAsciiFamily(bytes, text) {
  if (!looksBinary(bytes)) return parseTestLinkShape(text)

  const inflated = inflateBoardview(bytes)
  if (!inflated) {
    throw new BoardParseError('this container is binary and no boardview payload could be recovered from it', {
      reason: 'binary',
      hint:
        'Packed .tvw/.bdv/.fz files are read through their zlib payload. A file that is not zlib-packed needs its vendor tool or a converter first.',
    })
  }
  const result = parseTestLinkShape(inflated.toString('latin1'))
  result.warnings.push('payload recovered from a packed binary container')
  return result
}
