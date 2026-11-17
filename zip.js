/**
 * Minimal ZIP reader for WrenchBench.
 *
 * Boardview files are distributed in archives far more often than loose: a
 * vendor drop is a `.zip` holding one `.pcb` and a schematic PDF, and a
 * technician does not want to unpack it by hand before importing. Node ships
 * zlib but no ZIP container, so this reads the central directory and inflates
 * entries with the raw deflate support that is already there.
 *
 * Deliberately bounded and read-only:
 *   - stored (0) and deflate (8) entries only; encrypted and exotic methods are
 *     reported, not guessed at;
 *   - a total expansion ceiling, because a small archive can claim a huge entry;
 *   - Zip64 is not supported, and says so rather than returning nonsense.
 */

import zlib from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** Nothing here should ever need more than this much decompressed data. */
const MAX_TOTAL_BYTES = 192 * 1024 * 1024
const MAX_ENTRIES = 512

/** Does this payload start like a ZIP? */
export function isZip(bytes) {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL
}

function findEndOfCentralDirectory(bytes) {
  // EOCD is within the last 64 KiB (it can be followed by a comment).
  const floor = Math.max(0, bytes.length - 66000)
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD) return at
  }
  return -1
}

/**
 * List the entries of a ZIP archive.
 *
 * @param {Buffer} bytes the archive
 * @returns {{entries: {name: string, method: number, compressedSize: number, size: number, offset: number, encrypted: boolean}[], warnings: string[]}}
 */
export function listZipEntries(bytes) {
  const warnings = []
  const entries = []
  if (!isZip(bytes)) return { entries, warnings: ['not a ZIP archive'] }

  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd === -1) {
    warnings.push('the archive has no end-of-central-directory record (truncated, or Zip64)')
    return { entries, warnings }
  }

  const count = bytes.readUInt16LE(eocd + 10)
  let at = bytes.readUInt32LE(eocd + 16)
  if (count > MAX_ENTRIES) warnings.push(`the archive declares ${count} entries; only the first ${MAX_ENTRIES} were read`)
  if (at === 0xffffffff) {
    warnings.push('this is a Zip64 archive, which is not supported; unzip it and import the files directly')
    return { entries, warnings }
  }

  for (let index = 0; index < Math.min(count, MAX_ENTRIES); index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL) {
      warnings.push('the central directory ended early')
      break
    }
    const flags = bytes.readUInt16LE(at + 8)
    const method = bytes.readUInt16LE(at + 10)
    const compressedSize = bytes.readUInt32LE(at + 20)
    const size = bytes.readUInt32LE(at + 24)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const offset = bytes.readUInt32LE(at + 42)
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    if (!name.endsWith('/')) {
      entries.push({
        name,
        method,
        compressedSize,
        size,
        offset,
        encrypted: (flags & 0x1) !== 0,
      })
    }
    at += 46 + nameLength + extraLength + commentLength
  }

  return { entries, warnings }
}

/**
 * Read one entry's bytes.
 *
 * @returns {{data: Buffer|null, reason: string|null}}
 */
export function readZipEntry(bytes, entry) {
  if (entry.encrypted) return { data: null, reason: 'the entry is encrypted' }
  if (entry.method !== 0 && entry.method !== 8) {
    return { data: null, reason: `compression method ${entry.method} is not supported` }
  }
  const at = entry.offset
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL) {
    return { data: null, reason: 'the local header is unreadable' }
  }
  const nameLength = bytes.readUInt16LE(at + 26)
  const extraLength = bytes.readUInt16LE(at + 28)
  const start = at + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > bytes.length) return { data: null, reason: 'the entry is truncated' }

  const raw = bytes.subarray(start, end)
  if (entry.method === 0) return { data: Buffer.from(raw), reason: null }

  try {
    const inflated = zlib.inflateRawSync(raw)
    if (inflated.length > MAX_TOTAL_BYTES) return { data: null, reason: 'the entry expands past the safety ceiling' }
    return { data: inflated, reason: null }
  } catch (error) {
    return { data: null, reason: `deflate failed (${error instanceof Error ? error.message : String(error)})` }
  }
}

/**
 * Pull everything interesting out of an archive.
 *
 * @param {Buffer} bytes the archive
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.want] which entries to extract (default: all)
 * @returns {{files: {name: string, data: Buffer}[], warnings: string[], skipped: {name: string, reason: string}[]}}
 */
export function extractZip(bytes, options = {}) {
  const want = options.want ?? (() => true)
  const { entries, warnings } = listZipEntries(bytes)
  const files = []
  const skipped = []
  let total = 0

  for (const entry of entries) {
    if (!want(entry.name)) continue
    const { data, reason } = readZipEntry(bytes, entry)
    if (!data) {
      skipped.push({ name: entry.name, reason: reason ?? 'unreadable' })
      continue
    }
    if (total + data.length > MAX_TOTAL_BYTES) {
      warnings.push('the archive expands past the safety ceiling; later entries were skipped')
      break
    }
    total += data.length
    files.push({ name: entry.name, data })
  }

  return { files, warnings, skipped }
}
