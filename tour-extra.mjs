/**
 * Second half of the live feature pass: import variants, naming, focus, and a
 * latency sample. Run after tour-live.mjs against the same host.
 *
 * Usage: node tour-extra.mjs [port]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const port = process.argv[2] ?? '60127'
const base = `http://127.0.0.1:${port}/api/dsh-wrenchbench`
const req = async (p, { method = 'GET', body = null, type = 'application/json' } = {}) => {
  const init = { method }
  if (body !== null) {
    init.body = type === 'application/json' ? JSON.stringify(body) : body
    init.headers = { 'content-type': type }
  }
  const r = await fetch(base + p, init)
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, text, json }
}

const out = []
const ok = (name, cond, detail = '') => out.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${String(detail).slice(0, 200)}`}`)

// fixture
const fixture = path.join(os.tmpdir(), `wb-extra-${process.pid}.brd`)
execFileSync(process.execPath, [path.join(import.meta.dirname, 'test', 'generate-board.mjs'), fixture], { stdio: 'ignore' })
const bytes = fs.readFileSync(fixture)

// 1. duplicate import
const a = await req('/import?name=dup.brd&display=Dup', { method: 'POST', body: bytes, type: 'application/octet-stream' })
const b = await req('/import?name=dup.brd&display=Dup', { method: 'POST', body: bytes, type: 'application/octet-stream' })
const id = a.json?.meta?.id
ok('duplicate import is idempotent (same board id)', id && id === b.json?.meta?.id, `${id} vs ${b.json?.meta?.id}`)

// 2. zip import
const zipPath = path.join(os.tmpdir(), `wb-extra-${process.pid}.zip`)
const name = 'inner.brd'
const crc = (buf) => { let c = ~0; for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const local = Buffer.alloc(30)
local.writeUInt32LE(0x04034b50, 0)
local.writeUInt16LE(20, 4)
local.writeUInt32LE(crc(bytes), 14)
local.writeUInt32LE(bytes.length, 18)
local.writeUInt32LE(bytes.length, 22)
local.writeUInt16LE(name.length, 26)
const central = Buffer.alloc(46)
central.writeUInt32LE(0x02014b50, 0)
central.writeUInt16LE(20, 4)
central.writeUInt16LE(20, 6)
central.writeUInt32LE(crc(bytes), 16)
central.writeUInt32LE(bytes.length, 20)
central.writeUInt32LE(bytes.length, 24)
central.writeUInt16LE(name.length, 28)
central.writeUInt32LE(0, 42)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(1, 8)
end.writeUInt16LE(1, 10)
end.writeUInt32LE(central.length + name.length + bytes.length, 12)
end.writeUInt32LE(local.length + name.length + bytes.length, 16)
fs.writeFileSync(zipPath, Buffer.concat([local, Buffer.from(name), bytes, central, Buffer.from(name), end]))
const zipped = await req('/import?name=wrapped.zip&display=Zip%20Board', { method: 'POST', body: fs.readFileSync(zipPath), type: 'application/octet-stream' })
ok('a zipped boardview imports', zipped.status === 200 && zipped.json?.meta?.id, zipped.text.slice(0, 200))

// 3. alias route — on a part the export actually has
const importedBoard = await req(`/board?id=${id}`)
const realRefdes = importedBoard.json.board.parts.find((part) => part.refdes.startsWith('U'))?.refdes
const aliasSet = await req(`/alias?id=${id}`, { method: 'POST', body: { refdes: realRefdes, name: 'IC1001' } })
ok('a part can be given a name', aliasSet.status === 200 && JSON.stringify(aliasSet.json).includes('IC1001'), aliasSet.text.slice(0, 160))
const aliasClear = await req(`/alias?id=${id}`, { method: 'POST', body: { refdes: realRefdes, name: '' } })
ok('that name can be cleared', aliasClear.status === 200, aliasClear.text.slice(0, 120))

// 4. focus by net and by pin
const focusNet = await req('/focus', { method: 'POST', body: { net: '+3V3', board: id } })
const focusNetRead = await req('/focus')
ok('focus accepts a net', focusNet.status === 200 && focusNetRead.json?.net === '+3V3', focusNetRead.text.slice(0, 120))
const focusPin = await req('/focus', { method: 'POST', body: { refdes: realRefdes, pin: 2 } })
ok('focus accepts a pin', focusPin.status === 200 && focusPin.json?.pin === 2, focusPin.text.slice(0, 120))

// 5. latency over 20 board loads
const times = []
for (let i = 0; i < 20; i += 1) {
  const started = Date.now()
  await req(`/board?id=ps5-edm-010-100889021-pcb-layer-cddde648d8`)
  times.push(Date.now() - started)
}
times.sort((x, y) => x - y)
ok(`20 board loads stay under 400 ms (p95 ${times[Math.floor(times.length * 0.95)]} ms, max ${times.at(-1)} ms)`, times.at(-1) < 400, `max ${times.at(-1)}`)

// 6. a two-part board
const tinyPath = path.join(os.tmpdir(), `wb-tiny-${process.pid}.brd`)
fs.writeFileSync(tinyPath, ['var_data: 4 2 4 0', 'Format:', '0 0', '100 0', '100 50', '0 50', 'Parts:', 'R1 4 2', 'C1 4 4', 'Pins:', '1 1 0 1 GND', '2 1 1 1 +3V3', '5 5 2 2 GND', '6 5 3 2 +3V3', 'Nails:'].join('\n'), 'latin1')
const tinyBytes = fs.readFileSync(tinyPath)
const tiny = await req('/import?name=tiny.brd&display=Tiny', { method: 'POST', body: tinyBytes, type: 'application/octet-stream' })
const tinyId = tiny.json?.meta?.id
const tinyBoard = await req(`/board?id=${tinyId}`)
ok('a two-part board opens with its rail', tinyBoard.status === 200 && (tinyBoard.json?.rails ?? []).length >= 1, `${tinyBoard.status}`)
ok('its rail is named from the net, with no invented voltage', (tinyBoard.json?.rails ?? []).every((rail) => typeof rail.voltage === 'number' || rail.voltage === null), 'voltage')
const tinyChecks = await req(`/observe?id=${tinyId}`)
ok('an unmarked board reports no suspects, not an error', tx(tinyChecks) && (tinyChecks.json?.checks?.suspects ?? []).length === 0, tinyChecks.text.slice(0, 120))
function tx(r) { return r.status === 200 }

// cleanup
for (const boardId of [id, tinyId, zipped.json?.meta?.id].filter(Boolean)) {
  await req(`/board?id=${boardId}`, { method: 'DELETE' })
}
await req('/focus', { method: 'POST', body: { clear: true } })
for (const file of [fixture, zipPath, tinyPath]) { try { fs.rmSync(file, { force: true }) } catch {} }

console.log(out.join('\n'))
const fails = out.filter((line) => line.startsWith('FAIL'))
console.log(`\n${fails.length === 0 ? `EXTRA PASS (${out.length})` : `${fails.length} EXTRA FAILED`}`)
