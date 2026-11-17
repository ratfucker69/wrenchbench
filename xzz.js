/**
 * XZZPCB boardview reader.
 *
 * The container: an `XZZPCB V1.0` signature, three offsets at 0x20/0x24/0x28
 * (recorded relative to 0x20) pointing at a block stream, an image-name block
 * and the net table, and — in some deliveries — a plaintext annotation tail
 * after a `v6v6555v6v6` marker.
 *
 * Only the part blocks are DES-encrypted (fixed key, ECB); every other block is
 * plaintext. This reader takes the geometry and the part/pin/net database and
 * leaves the annotation tail alone: it carries diode readings and rename tables,
 * not the board.
 *
 * Coordinates are signed 32-bit integers in units of 1/10000 mil and the raw
 * frame is y-up, so y is negated on the way out — the canvas draws y down.
 *
 * Layout reference: docs/formats/XZZ_FORMAT.md in the boardripper project.
 */

import { desEcbDecrypt, XZZ_DES_KEY } from './xzz-des.js'

const SCALE = 10000
const BLOCK_PART = 0x07
const BLOCK_LINE = 0x05
const BLOCK_VIA = 0x02
const BLOCK_ARC = 0x01
const BLOCK_TEXT = 0x06
const BLOCK_TESTPAD = 0x09
const OUTLINE_LAYER = 28
const XOR_MARKER = 'v6v6555v6v6'

const MAX_PARTS = 200000
const MAX_PINS = 4000000
const MAX_BLOCKS = 12000000

export class XzzParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'XzzParseError'
  }
}

/**
 * Recover the single-byte XOR key, if the file is obfuscated.
 *
 * The key is documented at offset 0x10, but an implementation that XORs the
 * whole prefix including 0x10 leaves a zero there, so the key is derived from
 * the mangled signature when that happens. No file in the published library is
 * obfuscated, so this is a best-effort path.
 *
 * @returns {number} the key, or 0 when the file is plain
 */
export function xzzXorKey(bytes) {
  if (bytes.length < 0x30) return 0
  if (bytes.subarray(0, 11).toString('latin1').startsWith('XZZPCB')) return 0
  const derived = bytes[0] ^ 0x58 // 'X'
  if (derived !== 0) return derived
  return bytes[0x10]
}

/** True when the payload is an XZZPCB container, plain or XOR-obfuscated. */
export function isXZZ(bytes) {
  if (!bytes || bytes.length < 0x30) return false
  if (bytes.subarray(0, 11).toString('latin1').startsWith('XZZPCB')) return true
  const key = xzzXorKey(bytes)
  if (key === 0) return false
  const decoded = Buffer.from(bytes.subarray(0, 11)).map((value) => value ^ key)
  return decoded.toString('latin1').startsWith('XZZPCB')
}

/** Decode a string that is GB2312 on Chinese tooling and UTF-8 elsewhere. */
function decodeText(bytes) {
  if (bytes.length === 0) return ''
  let ascii = true
  for (const value of bytes) {
    if (value >= 0x80) {
      ascii = false
      break
    }
  }
  if (ascii) return bytes.toString('latin1')

  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return Buffer.from(bytes).toString('utf8')
  }
}

/** Sample an arc into straight segments, matching the exporter's 9-chord convention. */
function sampleArc(cx, cy, radius, startDegrees, endDegrees, steps = 9) {
  let sweep = endDegrees - startDegrees
  // The stored sweep is always counter-clockwise from start to end; lift a
  // negative difference by a full turn and never reduce it into ±180°.
  if (sweep < 0) sweep += 360
  if (!Number.isFinite(sweep) || Math.abs(sweep) < 1e-9) return []

  const segments = []
  let previous = null
  for (let index = 0; index <= steps; index += 1) {
    const angle = ((startDegrees + (sweep * index) / steps) * Math.PI) / 180
    const point = { x: cx + radius * Math.cos(angle), y: -(cy + radius * Math.sin(angle)) }
    if (previous) segments.push({ x1: previous.x, y1: previous.y, x2: point.x, y2: point.y })
    previous = point
  }
  return segments
}

/**
 * Chain loose segments into closed loops so the board can be filled rather
 * than only outlined. Tolerance is deliberately tiny: this format's arcs are
 * sampled into sub-mil steps, so a loose tolerance would eat real segments.
 */
function chainLoops(segments, tolerance = 0.02) {
  const loops = []
  const remaining = segments.slice()
  const keyOf = (x, y) => `${Math.round(x / tolerance)}:${Math.round(y / tolerance)}`

  while (remaining.length > 0) {
    const loop = []
    let current = remaining.shift()
    const startKey = keyOf(current.x1, current.y1)
    let cursor = current
    loop.push(cursor)

    let guard = 0
    while (guard++ < 100000) {
      const endKey = keyOf(cursor.x2, cursor.y2)
      if (endKey === startKey) break
      let found = -1
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]
        if (keyOf(candidate.x1, candidate.y1) === endKey) {
          found = index
          break
        }
        if (keyOf(candidate.x2, candidate.y2) === endKey) {
          found = index
          // Walk the segment backwards so the chain stays ordered.
          remaining[index] = { x1: candidate.x2, y1: candidate.y2, x2: candidate.x1, y2: candidate.y1 }
          break
        }
      }
      if (found === -1) break
      cursor = remaining.splice(found, 1)[0]
      loop.push(cursor)
    }

    if (loop.length >= 3) loops.push(loop)
  }

  return loops
}

function loopToOutline(loop) {
  const points = loop.map((segment) => ({ x: segment.x1, y: segment.y1 }))
  return points
}

function loopArea(points) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area / 2)
}

/**
 * Read one XZZPCB payload.
 *
 * @param {Buffer|Uint8Array} input raw file bytes
 * @returns {{format: string, units: string, outline: object[], edges: object[], parts: object[], pins: object[], nails: object[], warnings: string[]}}
 * @throws {XzzParseError} when the container does not decode
 */
export function parseXZZ(input) {
  let bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const warnings = []

  if (bytes.length < 0x60) throw new XzzParseError('the file is too small to hold an XZZ header')
  if (!isXZZ(bytes)) throw new XzzParseError('this is not an XZZPCB container')

  // Undo the optional single-byte XOR obfuscation.
  const xorKey = xzzXorKey(bytes)
  if (xorKey !== 0) {
    const markerAt = bytes.indexOf(Buffer.from(XOR_MARKER, 'latin1'))
    const limit = markerAt === -1 ? bytes.length : markerAt
    const copy = Buffer.from(bytes)
    for (let index = 0; index < limit; index += 1) copy[index] ^= xorKey
    bytes = copy
    warnings.push(`header XOR key 0x${xorKey.toString(16)} applied up to the annotation marker`)
  }

  const u32 = (offset) => {
    if (offset < 0 || offset + 4 > bytes.length) throw new XzzParseError(`read past the end of the file at 0x${offset.toString(16)}`)
    return bytes.readUInt32LE(offset)
  }
  const i32 = (offset) => {
    if (offset < 0 || offset + 4 > bytes.length) throw new XzzParseError(`read past the end of the file at 0x${offset.toString(16)}`)
    return bytes.readInt32LE(offset)
  }

  const streamStart = 0x20 + u32(0x20)
  const imageStart = 0x20 + u32(0x24)
  const netStart = 0x20 + u32(0x28)

  if (streamStart < 0x40 || streamStart >= bytes.length) throw new XzzParseError('the block stream offset is invalid')
  if (netStart >= bytes.length || netStart < streamStart) throw new XzzParseError('the net table offset is invalid')

  const streamSize = u32(streamStart)
  const streamEnd = streamStart + 4 + streamSize
  if (streamEnd > bytes.length) throw new XzzParseError('the block stream runs past the end of the file')

  // --- net table -----------------------------------------------------------
  // The region opens with its own byte size; entries follow it.
  const netRegionSize = u32(netStart)
  const netRegionEnd = Math.min(netStart + 4 + netRegionSize, bytes.length)
  if (netRegionSize < 8 || netStart + 4 + netRegionSize > bytes.length) {
    throw new XzzParseError('the net table region does not fit inside the file')
  }

  const netNames = []
  let netCursor = netStart + 4
  let netGuard = 0
  while (netCursor + 8 <= netRegionEnd && netGuard++ < 4000000) {
    const entrySize = u32(netCursor)
    if (entrySize < 8 || netCursor + entrySize > netRegionEnd) break
    const index = u32(netCursor + 4)
    if (index > 0) netNames[index] = decodeText(bytes.subarray(netCursor + 8, netCursor + entrySize))
    netCursor += entrySize
  }
  if (netNames.length === 0) warnings.push('the net table carried no entries')

  // --- block stream --------------------------------------------------------
  const parts = []
  const pins = []
  const edgeSegments = []
  const testPads = []
  let partCursor = 0
  let blockCursor = streamStart + 4
  let blockGuard = 0

  while (blockCursor + 5 <= streamEnd && blockGuard++ < MAX_BLOCKS) {
    const type = bytes[blockCursor]
    const size = u32(blockCursor + 1)
    const payload = blockCursor + 5
    if (size < 0 || payload + size > bytes.length) {
      warnings.push(`a truncated block of type 0x${type.toString(16)} ended the stream walk`)
      break
    }

    if (type === BLOCK_LINE && size >= 28) {
      const layer = u32(payload)
      const x1 = i32(payload + 4) / SCALE
      const y1 = -i32(payload + 8) / SCALE
      const x2 = i32(payload + 12) / SCALE
      const y2 = -i32(payload + 16) / SCALE
      if (layer === OUTLINE_LAYER) edgeSegments.push({ x1, y1, x2, y2 })
    } else if (type === BLOCK_ARC && size >= 24) {
      const layer = u32(payload)
      if (layer === OUTLINE_LAYER) {
        const cx = i32(payload + 4) / SCALE
        const cy = i32(payload + 8) / SCALE
        const radius = i32(payload + 12) / SCALE
        const start = i32(payload + 16) / SCALE
        const end = i32(payload + 20) / SCALE
        for (const segment of sampleArc(cx, cy, radius, start, end)) edgeSegments.push(segment)
      }
    } else if (type === BLOCK_PART) {
      if (parts.length >= MAX_PARTS) {
        warnings.push('component ceiling reached; the board was cut short')
        break
      }
      const plain = desEcbDecrypt(bytes, payload, size, XZZ_DES_KEY)
      try {
        const part = readPart(plain)
        if (part) {
          part.partIndex = parts.length
          for (const pin of part.pins) {
            if (pins.length >= MAX_PINS) break
            pin.part = part.partIndex
            pin.net = pin.netIndex && netNames[pin.netIndex] ? netNames[pin.netIndex] : null
            delete pin.netIndex
            pins.push(pin)
          }
          part.pins = part.pins.length
          parts.push({
            refdes: part.refdes,
            side: part.side,
            layer: part.layer,
            smd: part.smd,
            pins: part.pins,
            bbox: part.bbox,
            value: part.value,
          })
          partCursor += 1
        }
      } catch (error) {
        warnings.push(`a component block could not be decoded (${error instanceof Error ? error.message : String(error)})`)
      }
    } else if (type === BLOCK_TESTPAD && size >= 60) {
      const x = i32(payload + 4) / SCALE
      const y = -i32(payload + 8) / SCALE
      const nameLen = u32(payload + 20)
      const netIndex = u32(payload + 24 + nameLen + 32)
      testPads.push({ x, y, net: netIndex && netNames[netIndex] ? netNames[netIndex] : null })
    }

    blockCursor = payload + size
  }

  if (blockCursor !== streamEnd) {
    warnings.push(
      `the block walk ended at 0x${blockCursor.toString(16)} rather than the declared 0x${streamEnd.toString(16)}`,
    )
  }

  const usableParts = parts.filter((part) => part.pins > 0)
  if (usableParts.length === 0 && pins.length === 0) {
    throw new XzzParseError('no component blocks could be decoded from this container')
  }

  // --- outline -------------------------------------------------------------
  // Every outline segment is kept so the canvas can draw the full board edge,
  // including the second half of a two-sided pack and any cutouts. The largest
  // closed loop additionally becomes the fillable outline.
  let outline = []
  if (edgeSegments.length > 0) {
    const loops = chainLoops(edgeSegments)
    if (loops.length > 0) {
      const ranked = loops
        .map((loop) => {
          const points = loopToOutline(loop)
          return { points, area: loopArea(points) }
        })
        .sort((a, b) => b.area - a.area)
      outline = ranked[0].points
      if (loops.length > 1) {
        warnings.push(
          `${loops.length} outline loops found; the largest fills the board and all ${edgeSegments.length} segments are drawn`,
        )
      }
    }
  }

  return {
    format: 'xzzpcb',
    units: 'unit',
    outline,
    edges: edgeSegments,
    parts,
    pins,
    nails: testPads,
    warnings,
  }
}

/**
 * Decode one decrypted part payload.
 *
 * Measured layout:
 *   @0   u32 partSize (equals the payload length)
 *   @4   u32 flag
 *   @8   i32 x, @12 i32 y, @16 u32 angle
 *   @20  u8, @21 u8
 *   @22  u16 groupNameLen, then the group name
 *   then the part's own 0x06 label block, whose text is the refdes:
 *        u8 0x06, u32 size (= 30 + textLen), 26 bytes, u32 textLen, text
 *   then typed sub-blocks: u8 type, u32 size, payload
 */
function readPart(plain) {
  const u32 = (offset) => plain.readUInt32LE(offset)
  const i32 = (offset) => plain.readInt32LE(offset)

  if (plain.length < 40) return null

  const originX = i32(8) / SCALE
  const originY = -i32(12) / SCALE
  const groupNameLen = u32(22)

  let cursor = 26
  if (groupNameLen > 0) {
    if (groupNameLen > 512 || cursor + groupNameLen > plain.length) return null
    cursor += groupNameLen
  }

  // The part's own label carries the reference designator.
  if (cursor + 35 > plain.length) return null
  if (plain[cursor] !== BLOCK_TEXT) return null
  const labelSize = u32(cursor + 1)
  const refdesLen = u32(cursor + 31)
  if (refdesLen <= 0 || refdesLen > 64 || labelSize < 30 || cursor + 35 + refdesLen > plain.length) return null
  const refdesRaw = decodeText(plain.subarray(cursor + 35, cursor + 35 + refdesLen)).trim()
  if (refdesRaw.length === 0) return null
  // Some exports append a duplicate/side index to the designator ("C060_1").
  // The designator is the part before it; the suffix is kept as the side marker
  // so two copies of one designator stay distinguishable without polluting the
  // name a technician has to type.
  const suffixMatch = refdesRaw.match(/^(.*?)_(\d{1,2})$/)
  const refdes = suffixMatch ? suffixMatch[1] : refdesRaw
  const side = suffixMatch ? Number(suffixMatch[2]) : null

  let partCursor = cursor + 5 + labelSize
  let value = null

  const pins = []
  let pinCount = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let drilled = false
  let guard = 0

  while (partCursor + 5 <= plain.length && guard++ < 20000) {
    const type = plain[partCursor]
    const size = u32(partCursor + 1)
    const payload = partCursor + 5
    if (size < 0 || payload + size > plain.length) break

    if (type === BLOCK_TESTPAD && size >= 60) {
      // Pin sub-block.
      const x = i32(payload + 4) / SCALE
      const y = -i32(payload + 8) / SCALE
      const drill = u32(payload + 12)
      const nameLen = u32(payload + 20)
      if (nameLen > 0 && nameLen < 512 && payload + 24 + nameLen + 36 <= plain.length) {
        const netIndex = u32(payload + 24 + nameLen + 32)
        pinCount += 1
        if (drill > 0) drilled = true
        pins.push({ x, y, probe: null, part: 0, index: pinCount, net: null, netIndex, layer: 'top' })
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    } else if (type === BLOCK_TEXT && size > 30 && value === null) {
      // The first body label that is not the refdes is the BOM value.
      const textLen = u32(payload + 26)
      if (textLen > 0 && textLen < 256 && 30 + textLen <= size) {
        const text = decodeText(plain.subarray(payload + 30, payload + 30 + textLen)).trim()
        if (text.length > 0 && text.toUpperCase() !== refdes.toUpperCase()) value = text
      }
    }

    partCursor = payload + size
  }

  const bbox =
    pinCount > 0
      ? { x1: minX, y1: minY, x2: maxX, y2: maxY }
      : { x1: originX, y1: originY, x2: originX, y2: originY }

  return { refdes, side, layer: 'top', smd: !drilled, pins, bbox, value }
}
