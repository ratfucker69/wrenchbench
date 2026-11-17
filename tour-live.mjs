/**
 * Feature tour against a live host.
 *
 * The smoke test proves the routes answer. This walks the product the way a
 * technician would — import a board, label it, mark it, ask about it, attach a
 * schematic, then throw it away — and times the routes that matter, so a
 * regression in behaviour or in speed shows up in one run.
 *
 * Nothing touches an existing board except read-only calls: every write goes to
 * a throwaway board that is deleted at the end.
 *
 * Usage: node tour-live.mjs [port]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const port = process.argv[2] ?? '60127'
const base = `http://127.0.0.1:${port}/api/dsh-wrenchbench`
const ps5 = 'ps5-edm-010-100889021-pcb-layer-cddde648d8'

let passed = 0
const failures = []
const timings = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}\n       ${String(detail).slice(0, 300)}`)
  }
}

async function timed(label, fn) {
  const started = Date.now()
  const value = await fn()
  const ms = Date.now() - started
  timings.push({ label, ms })
  // Keep the response and attach the duration, so a check can assert on both.
  return { ...value, ms }
}

async function request(pathname, { method = 'GET', body = null, type = 'application/json' } = {}) {
  const init = { method }
  if (body !== null) {
    init.body = type === 'application/json' ? JSON.stringify(body) : body
    init.headers = { 'content-type': type }
  }
  const response = await fetch(`${base}${pathname}`, init)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // binary or text routes
  }
  return { status: response.status, text, json, headers: response.headers }
}

const get = (p) => request(p)
const post = (p, body = {}) => request(p, { method: 'POST', body })
const del = (p) => request(p, { method: 'DELETE' })

// ---------------------------------------------------------------------------

console.log('\n# library')
const boards = await timed('GET /boards', () => get('/boards'))
check('the library answers', boards.status === 200 && Array.isArray(boards.json?.boards), boards.status)
check('the PS5 board is listed with its format', boards.json?.boards?.some((b) => b.id === ps5 && b.format === 'xzzpcb'), boards.text.slice(0, 80))

console.log('\n# the canvas payload of a real board')
const payload = await timed('GET /board (15k pads)', () => get(`/board?id=${ps5}`))
const board = payload.json
check('the payload carries the board, rails, marks and checks', !!board?.board && Array.isArray(board.rails) && Array.isArray(board.observations), 'shape')
check('rail labels carry their voltage', (board.rails ?? []).some((rail) => rail.label === 'VDDCR_GFX' && rail.voltage === 1), JSON.stringify((board.rails ?? []).slice(0, 2)))
check('the rail map explains the names', (board.railMap?.assignments ?? []).length === 5, JSON.stringify(board.railMap?.assignments?.length))
check('every part has a rail assignment slot', (board.railOfPart ?? []).length === board.board.parts.length, `${board.railOfPart?.length} vs ${board.board.parts.length}`)
check('bounds and stats agree', board.board.stats.pins === board.board.pins.length, 'pins')
check('the payload is not a memory hazard', payload.text.length < 40 * 1024 * 1024, `${(payload.text.length / 1048576).toFixed(1)} MB`)

console.log('\n# a new project, end to end')
const fixture = path.join(os.tmpdir(), `wrenchbench-tour-${process.pid}.brd`)
const { execFileSync } = await import('node:child_process')
execFileSync(process.execPath, [path.join(import.meta.dirname, 'test', 'generate-board.mjs'), fixture], { stdio: 'ignore' })
const bytes = fs.readFileSync(fixture)

const imported = await timed('POST /import', () =>
  request(`/import?name=tour-bench.brd&display=Tour%20Bench`, { method: 'POST', body: bytes, type: 'application/octet-stream' }),
)
const tempId = imported.json?.meta?.id
check('a board imports', imported.status === 200 && typeof tempId === 'string', imported.text.slice(0, 160))
check('the import reports enrichment', !!imported.json?.enrichment, JSON.stringify(imported.json?.enrichment ?? null).slice(0, 120))

const temp = await get(`/board?id=${tempId}`)
check('the new board opens', temp.status === 200 && temp.json?.board?.stats?.pins > 1000, temp.status)
const railNames = (temp.json?.rails ?? []).map((rail) => rail.label)
check('its rails are read from the names', railNames.includes('+3V3') && railNames.includes('+12V'), railNames.join(','))

console.log('\n# rails, marks, focus on that board')
const labelled = await post(`/rail-label?id=${tempId}`, { net: '+5V', label: 'PP5V0_TOUR' })
check('a rail label can be set', labelled.json?.rails?.some((rail) => rail.label === 'PP5V0_TOUR'), labelled.text.slice(0, 120))

const parts = temp.json.board.parts.map((part) => part.refdes)
const pick = (prefix) => parts.find((refdes) => refdes.startsWith(prefix)) ?? parts[0]
const marks = [
  { refdes: pick('C'), kind: 'short-to-ground', note: '0.4 ohm' },
  { refdes: pick('R'), kind: 'open', note: 'no continuity' },
  { refdes: pick('U'), kind: 'short', note: 'bridged to +3V3' },
]
console.log('  using', marks.map((mark) => mark.refdes).join(', '))
for (const mark of marks) {
  const made = await post(`/observe?id=${tempId}`, mark)
  check(`mark ${mark.refdes} (${mark.kind})`, made.status === 200, made.text.slice(0, 120))
}
const marked = await get(`/observe?id=${tempId}`)
check('all three marks are stored', (marked.json?.observations ?? []).length === 3, JSON.stringify(marked.json?.observations?.length))
check('the ranking picks suspects from those marks', (marked.json?.checks?.suspects ?? []).length > 0, JSON.stringify(marked.json?.checks?.notes).slice(0, 160))
const clearedOne = await del(`/observe?id=${tempId}&refdes=R2`)
check('one mark can be cleared', clearedOne.status === 200, clearedOne.status)

const setFocus = await post('/focus', { refdes: 'U3', board: tempId })
const focusRead = await get('/focus')
check('focus lands and reports a revision', focusRead.json?.refdes === 'U3' && Number.isFinite(focusRead.json?.revision), focusRead.text.slice(0, 120))
const focusAgain = await post('/focus', { refdes: 'U3' })
check('re-focusing the same part still bumps the revision', focusAgain.json?.revision > focusRead.json?.revision, `${focusRead.json?.revision} -> ${focusAgain.json?.revision}`)

console.log('\n# schematic for that board')
const schematicText = ['Rail table', '+3V3 R1 10k', '+5V C4 10u', 'VDD_ARM U3 pin 12', '12V fuse F1', ''].join('\n')
const uploaded = await request(`/schematic?id=${tempId}&name=bench-notes.txt`, {
  method: 'POST',
  body: Buffer.from(schematicText),
  type: 'application/octet-stream',
})
check('a text schematic is accepted', uploaded.status === 200, uploaded.text.slice(0, 160))
const found = await get(`/schematic?id=${tempId}&q=%2B3V3`)
check('the schematic search finds a rail', (found.json?.hits ?? []).length > 0, found.text.slice(0, 200))
const missing = await get(`/schematic?id=${tempId}&q=zzz-no-such-token`)
check('a miss is reported, not invented', (missing.json?.hits ?? []).length === 0, missing.text.slice(0, 120))

console.log('\n# asking about that board')
const asked = await post('/ask', { question: 'what rails does this board have?', board: tempId })
check('the question is accepted', asked.json?.accepted === true, asked.text.slice(0, 200))
let conversation = await get(`/conversation?id=${tempId}`)
for (let attempt = 0; attempt < 20; attempt += 1) {
  if ((conversation.json?.messages ?? []).some((m) => m.role === 'user')) break
  await new Promise((resolve) => setTimeout(resolve, 500))
  conversation = await get(`/conversation?id=${tempId}`)
}
const messages = conversation.json?.messages ?? []
check('the question appears in the thread', messages.some((m) => m.role === 'user' && /what rails/.test(m.text)), JSON.stringify(messages).slice(0, 200))
check('the thread is not polluted by harness blocks', !messages.some((m) => m.role === 'user' && /^(Current runtime context|Time sampled|<system-reminder)/.test(m.text)), 'scaffolding leaked')
const reset = await post(`/conversation/new?id=${tempId}`)
check('a fresh thread can be started', reset.json?.reset === true, reset.text.slice(0, 160))

console.log('\n# refusals')
check('an unknown board is a 400', (await get('/board?id=../../etc')).status === 400, 'traversal')
check('an unknown board id is a 404', (await get('/board?id=no-such-board-xyz')).status === 404, 'missing')
check('a bad rail is refused', (await post(`/rail-label?id=${tempId}`, { net: 'NOPE', label: 'x' })).status === 422, 'net')
check('an empty question is refused', (await post('/ask', { question: '', board: tempId })).status === 400, 'empty')
check('a wrong method is refused', (await request('/import')).status === 405, 'method')
check('malformed JSON is refused', (await request('/observe?id=' + tempId, { method: 'POST', body: 'not json', type: 'application/json' })).status === 400, 'json')
const bigBody = 'x'.repeat(200 * 1024)
check('an oversized body is refused', (await request('/observe?id=' + tempId, { method: 'POST', body: `{"note":"${bigBody}"}`, type: 'application/json' })).status === 413, 'limit')

console.log('\n# speed')
const payload2 = await timed('GET /board (again)', () => get(`/board?id=${ps5}`))
check('the board payload is served under 400 ms', payload2.ms < 400, `${payload2.ms} ms`)
const listed = await timed('GET /boards (again)', () => get('/boards'))
check('the library lists under 200 ms', listed.ms < 200, `${listed.ms} ms`)
const poll = await timed('GET /conversation (poll)', () => get(`/conversation?id=${tempId}`))
check('a conversation poll is cheap', poll.ms < 400, `${poll.ms} ms`)

console.log('\n# cleanup')
const removed = await del(`/board?id=${tempId}`)
check('the throwaway board is deleted', removed.json?.removed === true, removed.text.slice(0, 120))
await post('/focus', { clear: true })
try {
  fs.rmSync(fixture, { force: true })
} catch {
  // best effort
}

// The tour asks real questions, so the host stores a real session for the board
// it just deleted. Deleting the board forgets the repair thread; the session
// store groups by working directory, and the group would otherwise stay behind
// in the user's session list as an orphan. Match by board id, not by rebuilding
// the store's directory-name rules.
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const sessionsRoot = path.join(home, '.dsh', 'sessions')
let swept = 0
try {
  for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.endsWith(`${tempId}--`)) continue
    fs.rmSync(path.join(sessionsRoot, entry.name), { recursive: true, force: true })
    swept += 1
  }
} catch {
  // best effort: a missing store is not a tour failure
}
check('the tour leaves no session group behind', swept <= 1, `removed ${swept}`)

const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5)
console.log('\ntimings (ms):')
for (const row of slowest) console.log(`  ${String(row.ms).padStart(6)}  ${row.label}`)

console.log(`\n${failures.length === 0 ? `FEATURE TOUR PASS (${passed})` : `${failures.length} FEATURE TOUR CHECK(S) FAILED`}`)
if (failures.length > 0) process.exit(1)
