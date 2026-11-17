/**
 * End-user smoke test against the live plugin routes.
 *
 * Not a unit test: it drives the running host exactly as the panel does, so it
 * catches the class of fault the tests cannot see — a route that is registered
 * but returns the wrong shape, a label that does not reach the legend, an agent
 * prompt that is refused. Run with `node smoke-live.mjs [port]`.
 */
const port = process.argv[2] ?? '60127'
const base = `http://127.0.0.1:${port}/api/dsh-wrenchbench`
const boardId = 'ps5-edm-010-100889021-pcb-layer-cddde648d8'

let passed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}\n       ${String(detail).slice(0, 400)}`)
  }
}

async function get(path) {
  const response = await fetch(`${base}${path}`)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // Text routes send raw bytes.
  }
  return { status: response.status, text, json }
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // ignore
  }
  return { status: response.status, text, json }
}

console.log(`\n# library (${base})`)
const boards = await get('/boards')
check('the library lists the PS5 board', boards.json?.boards?.some((entry) => entry.id === boardId), boards.text)

console.log('\n# board payload — what the canvas draws')
const board = await get(`/board?id=${boardId}`)
check('the board route answers', board.status === 200 && board.json?.board?.stats?.pins === 15417, board.status)
const rails = board.json?.rails ?? []
check('rails carry a label and a voltage', rails.some((rail) => rail.label === 'VDDCR_GFX' && rail.voltage === 1), JSON.stringify(rails.slice(0, 2)))
check('the small named rail is present (Net75)', rails.some((rail) => rail.name === 'Net75' && rail.label === 'VDDCR_SOC'), rails.map((rail) => rail.name).join(','))
check('the rail map explains each name', (board.json?.railMap?.assignments ?? []).length === 5, JSON.stringify(board.json?.railMap?.assignments?.length))
check('bench marks and checks travel with the board', Array.isArray(board.json?.observations) && Array.isArray(board.json?.checks?.suspects), 'shape')
check('parts carry their rail assignment', (board.json?.railOfPart ?? []).length > 0, 'empty')

console.log('\n# rails and labels')
const labelled = await post(`/rail-label?id=${boardId}`, { net: 'Net226', label: '3.3 V test rail' })
check('a bench label is accepted', labelled.status === 200 && (labelled.json?.rails ?? []).some((rail) => rail.label === '3.3 V test rail'), labelled.text)
const cleared = await post(`/rail-label?id=${boardId}`, { net: 'Net226', label: '' })
check('a bench label can be cleared', !(cleared.json?.rails ?? []).some((rail) => rail.label === '3.3 V test rail'), cleared.text)
const badLabel = await post(`/rail-label?id=${boardId}`, { net: 'Net99999', label: 'x' })
check('an unknown net is refused', badLabel.status === 422, badLabel.status)

console.log('\n# bench marks and ranked suspects')
const marked = await post(`/observe?id=${boardId}`, { refdes: 'C00173', kind: 'short-to-ground', note: 'smoke test' })
check('a mark is recorded', marked.status === 200, marked.text)
const afterMark = await get(`/observe?id=${boardId}`)
check('the mark reaches the suspect ranking', (afterMark.json?.checks?.suspects ?? []).length > 0, JSON.stringify(afterMark.json?.checks?.notes))
const unmarked = await fetch(`${base}/observe?id=${boardId}&refdes=C00173`, { method: 'DELETE' })
check('the mark can be cleared', unmarked.status === 200, unmarked.status)

console.log('\n# schematic search')
const search = await get(`/schematic?id=${boardId}&q=VDDCR_GFX`)
check('a rail name is found on a page', (search.json?.hits ?? []).length > 0, search.text.slice(0, 200))

console.log('\n# focus')
const focus = await post(`/focus`, { refdes: 'N15900' })
check('focus accepts a part', focus.status === 200, focus.text)
const focusRead = await get('/focus')
check('focus reads back with a revision', focusRead.json?.refdes === 'N15900' && Number.isFinite(focusRead.json?.revision), focusRead.text)
const clearedFocus = await post(`/focus`, { clear: true })
check('focus can be cleared', clearedFocus.status === 200, clearedFocus.text)

console.log('\n# enrichment')
const enriched = await post(`/enrich?id=${boardId}`, {})
check('enrichment runs and reports rail names', /Rail names: 5/.test(enriched.json?.text ?? ''), (enriched.json?.text ?? '').slice(0, 300))

console.log('\n# asking the agent')
const asked = await post('/ask', { question: 'smoke test — what is Net73?', board: boardId })
check('the ask bar is accepted', asked.json?.accepted === true && typeof asked.json?.sessionId === 'string', asked.text.slice(0, 240))
check('the prompt carries the board context', /board on the canvas/.test(asked.json?.composed ?? ''), (asked.json?.composed ?? '').slice(0, 160))
const emptyAsk = await post('/ask', { question: '   ', board: boardId })
check('an empty question is refused', emptyAsk.status === 400, emptyAsk.status)

console.log(`\n${failures.length === 0 ? `LIVE SMOKE PASS (${passed})` : `${failures.length} LIVE SMOKE CHECK(S) FAILED`}`)
if (failures.length > 0) process.exit(1)
