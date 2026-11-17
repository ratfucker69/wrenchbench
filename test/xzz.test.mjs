/**
 * XZZPCB reader test.
 *
 * The container is binary, partly DES-encrypted and cannot be synthesised here
 * (this module only decrypts), so the geometry checks need a real file. Pass
 * one as the first argument, or set XZZ_SAMPLE, or rely on the default search
 * for a PS5 boardview in the usual download folders. With no sample available
 * the structural checks still run and the geometry checks report SKIP.
 *
 * Run with `node test/xzz.test.mjs ["C:\path\to\board.pcb"]`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isXZZ, parseXZZ } from '../xzz.js'
import { parseBoard } from '../parsers.js'

const failures = []
function expect(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

console.log('signature detection')
const plain = Buffer.alloc(0x80)
plain.write('XZZPCB V1.0', 0, 'latin1')
expect('a plain signature is detected', isXZZ(plain) === true)

const obfuscated = Buffer.alloc(0x80)
obfuscated.write('XZZPCB V1.0', 0, 'latin1')
obfuscated[0x10] = 0x5a
// An exporter that keeps the key readable at 0x10 XORs the bytes before it.
for (let index = 0; index < 0x10; index += 1) obfuscated[index] ^= obfuscated[0x10]
expect('an XOR-obfuscated signature is detected', isXZZ(obfuscated) === true)

const notXzz = Buffer.alloc(0x80, 0x20)
notXzz.write('BVRAW_FORMAT_3', 0, 'latin1')
expect('another format is rejected', isXZZ(notXzz) === false)

expect('a truncated payload is rejected', (() => {
  try {
    parseBoard(plain, 'x.pcb')
    return false
  } catch {
    return true
  }
})())

function findSample() {
  const candidate = process.argv[2] ?? process.env.XZZ_SAMPLE
  if (candidate && fs.existsSync(candidate)) return candidate
  const folders = [path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents')]
  for (const folder of folders) {
    let entries
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.pcb$/i.test(entry.name)) continue
      const full = path.join(folder, entry.name)
      try {
        const head = Buffer.alloc(11)
        const fd = fs.openSync(full, 'r')
        fs.readSync(fd, head, 0, 11, 0)
        fs.closeSync(fd)
        if (head.toString('latin1').startsWith('XZZPCB')) return full
      } catch {
        // Unreadable candidates are skipped.
      }
    }
  }
  return undefined
}

const sample = findSample()
if (!sample) {
  console.log('\nSKIP geometry checks: no XZZ sample found (pass a path or set XZZ_SAMPLE)')
} else {
  console.log(`\ngeometry on ${path.basename(sample)}`)
  const bytes = fs.readFileSync(sample)
  const started = Date.now()
  const board = parseBoard(bytes, path.basename(sample))
  console.log(`  parsed in ${Date.now() - started} ms`)

  expect('the format is reported as xzzpcb', board.format === 'xzzpcb', board.format)
  expect('components were decoded', board.stats.parts > 100, String(board.stats.parts))
  expect('pads were decoded', board.stats.pins > 1000, String(board.stats.pins))
  expect('every pad resolved to a net', board.pins.every((pin) => pin.net !== null), `${board.pins.filter((pin) => !pin.net).length} without a net`)
  expect('nets were derived', board.stats.nets > 50, String(board.stats.nets))
  expect('an outline was found', board.outline.length > 2 || board.edges.length > 0, `${board.outline.length} pts / ${board.edges.length} segs`)
  expect('ground is recognised', board.nets.some((net) => net.ground), 'no ground net')
  expect('bounds are finite', Number.isFinite(board.bounds.minX) && Number.isFinite(board.bounds.maxY))
  expect('no pad sits outside the bounds it produced', board.pins.every((pin) => pin.x >= board.bounds.minX - 1 && pin.x <= board.bounds.maxX + 1))
  expect('a pad count is consistent with the component list', board.parts.reduce((total, part) => total + part.pins, 0) === board.pins.length)

  // The reader must be deterministic for the same bytes.
  const again = parseXZZ(bytes)
  expect(
    'two reads agree',
    again.parts.length === board.parts.length && again.pins.length === board.pins.length,
  )
}

if (failures.length > 0) {
  console.log(`\n${failures.length} XZZ CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nXZZ CHECKS PASS')
}
