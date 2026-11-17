/**
 * Format-agnostic ingestion tests.
 *
 * The promise is that a file is read for what it *is*, not what it is called:
 * a boardview inside a zip, a schematic that is really a CSV, a PDF with no
 * extension. The tests build each payload from scratch so they do not depend on
 * any file on this machine.
 *
 * Run with `node test/formats.test.mjs`.
 */
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { extractZip, isZip, listZipEntries } from '../zip.js'
import { extractSchematic } from '../schematic.js'
import { parseBoard } from '../parsers.js'

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** Build a zip with deflated members. */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of files) {
    const deflated = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, deflated)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + deflated.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

/**
 * A minimal Test_Link boardview, in the real grammar:
 *   Parts: <refdes> <layerBits> <endOfPinIndex>
 *   Pins:  <x> <y> <probe> <partIndex 1-based> [net]
 */
const BOARDVIEW = [
  'Parts:',
  'U1 4 2',
  'C7 4 4',
  'Pins:',
  '0 0 -99 1 VDDCR_SOC',
  '0 60 -99 1 VDDCR_SOC',
  '120 0 -99 2 GND',
  '120 60 -99 2 VDDCR_SOC',
  'Outline:',
  '0 0',
  '200 0',
  '200 120',
  '0 120',
].join('\n')

console.log('\nzip container')
check('a zip is recognised by its signature', () => {
  const zip = makeZip([['a.txt', Buffer.from('hello')]])
  assert.equal(isZip(zip), true)
  assert.equal(isZip(Buffer.from('not a zip')), false)
})
check('entries are listed with names and sizes', () => {
  const zip = makeZip([
    ['readme.txt', Buffer.from('hello')],
    ['board.pcb', Buffer.from(BOARDVIEW)],
  ])
  const { entries } = listZipEntries(zip)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ['board.pcb', 'readme.txt'])
})
check('a deflated member round-trips byte for byte', () => {
  const body = Buffer.from(BOARDVIEW.repeat(20))
  const zip = makeZip([['board.brd', body]])
  const { files } = extractZip(zip)
  assert.equal(files.length, 1)
  assert.equal(files[0].data.equals(body), true)
})
check('a truncated archive reports a warning instead of throwing', () => {
  const zip = makeZip([['a.txt', Buffer.from('hello')]])
  const truncated = zip.subarray(0, zip.length - 12)
  const listed = listZipEntries(truncated)
  assert.equal(listed.entries.length, 0)
  assert.ok(listed.warnings.length > 0)
})

console.log('\nboard from a container')
check('a boardview inside a zip is found and parsed', () => {
  const zip = makeZip([
    ['readme.txt', Buffer.from('vendor notes')],
    ['EDM-010.pcb', Buffer.from(BOARDVIEW)],
  ])
  const parsed = parseBoard(zip, 'download.zip')
  assert.equal(parsed.parts.length, 2)
  assert.equal(parsed.parts[0].refdes, 'U1')
  assert.ok(parsed.warnings.some((warning) => /inside the archive/.test(warning)))
})
check('an archive with nothing board-like fails with a reason', () => {
  const zip = makeZip([['notes.txt', Buffer.from('just words')]])
  assert.throws(() => parseBoard(zip, 'x.zip'), /no member of that archive/)
})
check('the extension never decides whether a board imports', () => {
  const parsed = parseBoard(Buffer.from(BOARDVIEW), 'file-without-extension')
  assert.equal(parsed.parts.length, 2)
})

console.log('\nschematic of any kind')
check('a CSV bill of materials is indexed as text', () => {
  const csv = Buffer.from('RefDes,Value,Notes\nC1027,0.1u,0603\nIC5006,CXD90061GG,BGA\n')
  const schematic = extractSchematic(csv, 'bom.csv')
  assert.equal(schematic.stats.pages, 1)
  assert.equal(schematic.pageNumbering, 'text-chunk')
  assert.ok(schematic.tokens.refdes.some((entry) => entry.name === 'C1027'))
})
check('a zip holding a text schematic uses the member', () => {
  const zip = makeZip([['schematic.txt', Buffer.from('IC5006 CXD90061GG\nVDDCR_SOC\n')]])
  const schematic = extractSchematic(zip, 'bundle.zip')
  assert.equal(schematic.name, 'schematic.txt')
  assert.ok(schematic.text.includes('CXD90061GG'))
})
check('form feeds become page breaks', () => {
  const text = Buffer.from('page one\n\fpage two\n\fpage three\n')
  const schematic = extractSchematic(text, 'sheets.txt')
  assert.equal(schematic.stats.pages, 3)
  assert.equal(schematic.pageNumbering, 'form-feed')
})
check('an image is refused, and the reason names the next step', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
  assert.throws(() => extractSchematic(png, 'scan.png'), /OCR/)
})
check('an unreadable binary is refused with its magic bytes', () => {
  const blob = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc, 0x00, 0x11, 0x22])
  assert.throws(() => extractSchematic(blob, 'mystery.bin'), /no readable schematic text/)
})
check('an empty upload is refused', () => {
  assert.throws(() => extractSchematic(Buffer.alloc(0), 'empty'), /empty/)
})

console.log(failures.length === 0 ? `\nFORMAT CHECKS PASS (${passed})` : `\n${failures.length} FORMAT CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
