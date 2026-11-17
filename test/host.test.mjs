/**
 * Host-half integration test: drives the real route handlers and the real
 * agent tools through a fake Cordis context, against a throwaway library
 * directory. Run with `node test/host.test.mjs`.
 */
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const libraryDir = path.join(os.tmpdir(), `wrenchbench-test-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

const { apply } = await import('../index.js')
const store = await import('../store.js')

const routes = []
const tools = []
const registered = []
const services = {}

const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
  effect(fn) {
    registered.push(fn())
    return () => {}
  },
  // Services the host may look up at request time. Tests install fakes here so
  // the agent-prompt route can be driven without a live Agent.
  get(name) {
    return services[name]
  },
}

apply(ctx, {})

function call(routePath, { method = 'GET', url = routePath, body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const route = routes.find((entry) => entry.path === routePath)
    if (!route) {
      reject(new Error(`no route registered at ${routePath}`))
      return
    }
    const req = body === null ? Readable.from([]) : Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)])
    req.method = method
    req.url = url
    req.headers = headers
    req.destroy = () => {}

    const chunks = []
    const res = {
      status: 0,
      headers: {},
      writeHead(status, values) {
        this.status = status
        this.headers = values ?? {}
      },
      end(data) {
        if (data !== undefined) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: this.status, headers: this.headers, text, json })
      },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

function tool(name) {
  const found = tools.find((entry) => entry.name === name)
  if (!found) throw new Error(`tool ${name} was not registered`)
  return (args) => found.execute(args ?? {}, {})
}

function textOf(result) {
  const rendered = result && typeof result === 'object' && 'text' in result ? result.text : String(result)
  return rendered
}

const failures = []
function expect(label, condition, detail) {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

const testLink = `var_data: 4 3 6 2
Format:
0 0
100 0
100 50
0 50
Parts:
U1 1 3
R1 5 5
C1 1 6
Pins:
10 10 1 1 GND
20 10 2 1 +3V3
30 10 3 1 +3V3
40 10 4 2 GND
50 10 5 2 +5V
60 10 6 3 GND
Nails:
1 10 10 1 GND
2 20 10 1 +3V3
`

console.log('\n# routes and import')
const imported = await call('/api/dsh-wrenchbench/import', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/import?name=demo.brd&display=Demo%20Board',
  body: Buffer.from(testLink),
})
expect('import returns 200', imported.status === 200, `${imported.status} ${imported.text.slice(0, 200)}`)
const boardId = imported.json?.meta?.id
expect('import yields a board id', typeof boardId === 'string' && boardId.length > 0, String(boardId))
expect('import reports 3 components', imported.json?.meta?.stats?.parts === 3, JSON.stringify(imported.json?.meta?.stats))

const listed = await call('/api/dsh-wrenchbench/boards')
expect('boards lists the imported board', listed.json?.boards?.length === 1, JSON.stringify(listed.json?.boards?.length))
expect('boards exposes the format catalogue', Array.isArray(listed.json?.formats) && listed.json.formats.includes('.kicad_pcb'))

const one = await call('/api/dsh-wrenchbench/board', { url: `/api/dsh-wrenchbench/board?id=${boardId}` })
expect('board route returns the model', one.json?.board?.stats?.pins === 6, JSON.stringify(one.json?.board?.stats))

const badId = await call('/api/dsh-wrenchbench/board', { url: '/api/dsh-wrenchbench/board?id=../../etc/passwd' })
expect('board route rejects a traversal id', badId.status === 400, String(badId.status))

console.log('\n# agent tools')
const boardsText = textOf(await tool('wrenchbench_boards')({}))
expect('wrenchbench_boards names the board', boardsText.includes('Demo Board'), boardsText)

const componentText = textOf(await tool('wrenchbench_component')({ refdes: 'U1' }))
expect('wrenchbench_component finds U1', componentText.includes('U1') && componentText.includes('+3V3'), componentText)
expect('wrenchbench_component lists pads', componentText.includes('pads: 1=GND'), componentText)

const missing = await tool('wrenchbench_component')({ refdes: 'U99' })
expect('wrenchbench_component refuses an invented refdes', missing.isError === true && /found: false/.test(missing.text), missing.text)
expect('wrenchbench_component suggests a closest match', missing.text.includes('U1'), missing.text)

const netText = textOf(await tool('wrenchbench_net')({ net: '+3V3' }))
expect('wrenchbench_net traces +3V3', netText.includes('+3V3') && netText.includes('U1'), netText)
expect('wrenchbench_net flags a power rail', netText.includes('[power rail]'), netText)

const groundText = textOf(await tool('wrenchbench_net')({ net: 'GND' }))
expect('wrenchbench_net flags ground', groundText.includes('[ground]'), groundText)

const searchText = textOf(await tool('wrenchbench_search')({ query: '3v3' }))
expect('wrenchbench_search finds the net', searchText.includes('+3V3'), searchText)

const measureText = textOf(await tool('wrenchbench_measure')({ refdes_a: 'U1', refdes_b: 'R1' }))
expect('wrenchbench_measure returns mm', /mm/.test(measureText), measureText)

const boardText = textOf(await tool('wrenchbench_board')({}))
expect('wrenchbench_board summarizes rails', boardText.includes('+3V3') && boardText.includes('Largest components'), boardText)

const focusResult = await tool('wrenchbench_focus')({ refdes: 'U1', net: '+3V3', annotation: 'probe here' })
expect('wrenchbench_focus accepts a real target', focusResult.isError !== true, focusResult.text)
const focusRead = await call('/api/dsh-wrenchbench/focus')
expect('focus route reflects the tool', focusRead.json?.refdes === 'U1' && focusRead.json?.net === '+3V3', JSON.stringify(focusRead.json))

const focusBad = await tool('wrenchbench_focus')({ refdes: 'ZZ9' })
expect('wrenchbench_focus refuses an invented refdes', focusBad.isError === true, focusBad.text)

const noSchematic = await tool('wrenchbench_schematic')({})
expect('wrenchbench_schematic reports a missing PDF', noSchematic.isError === true && /No schematic PDF/.test(noSchematic.text), noSchematic.text)

console.log('\n# schematic PDF ingestion')
/** Build a tiny but structurally real PDF whose content stream is Flate-compressed. */
function makePdf(text) {
  const content = `BT /F1 11 Tf 40 780 Td (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'))
  const parts = [
    Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'),
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n', 'latin1'),
    Buffer.from(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
    Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]
  return Buffer.concat(parts)
}

const pdf = makePdf('U7000 PP5V7_LCM backlight boost enable BL_EN rail +3V3')
const uploaded = await call('/api/dsh-wrenchbench/schematic', {
  method: 'POST',
  url: `/api/dsh-wrenchbench/schematic?id=${boardId}&name=board.pdf`,
  body: pdf,
})
expect('schematic upload returns 200', uploaded.status === 200, `${uploaded.status} ${uploaded.text.slice(0, 260)}`)
expect('schematic reports one page', uploaded.json?.stats?.pages === 1, JSON.stringify(uploaded.json?.stats))
expect('schematic extracts the text layer', uploaded.json?.stats?.chars > 20, JSON.stringify(uploaded.json?.stats))

const schematicTool = textOf(await tool('wrenchbench_schematic')({ query: 'U7000' }))
expect('wrenchbench_schematic cites the page', schematicTool.includes('p1') && schematicTool.includes('U7000'), schematicTool)

const schematicOverview = textOf(await tool('wrenchbench_schematic')({}))
expect('wrenchbench_schematic lists tokens', schematicOverview.includes('U7000'), schematicOverview)

const schematicSearch = await call('/api/dsh-wrenchbench/schematic', {
  url: `/api/dsh-wrenchbench/schematic?id=${boardId}&q=PP5V7`,
})
expect('schematic search route finds a hit', (schematicSearch.json?.hits ?? []).length > 0, schematicSearch.text.slice(0, 200))

console.log('\n# re-import is idempotent')
const again = await call('/api/dsh-wrenchbench/import', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/import?name=demo.brd',
  body: Buffer.from(testLink),
})
expect('same bytes yield the same id', again.json?.meta?.id === boardId, `${again.json?.meta?.id} vs ${boardId}`)
const relisted = await call('/api/dsh-wrenchbench/boards')
expect('the library still holds one board', relisted.json?.boards?.length === 1, String(relisted.json?.boards?.length))

console.log('\n# rejection paths')
const junk = await call('/api/dsh-wrenchbench/import', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/import?name=notes.txt',
  body: Buffer.from('this is not a boardview at all'),
})
expect('a non-boardview upload is refused', junk.status === 422, `${junk.status} ${junk.text.slice(0, 160)}`)

// Any file type is accepted: a plain-text schematic (a BOM, a KiCad sheet)
// is indexed rather than refused on its extension.
const textSchematic = await call('/api/dsh-wrenchbench/schematic', {
  method: 'POST',
  url: `/api/dsh-wrenchbench/schematic?id=${boardId}&name=bom.csv`,
  body: Buffer.from('RefDes,Value\nC1,0.1u\nR1,10k\n'),
})
expect(
  'a text schematic is accepted and indexed',
  textSchematic.status === 200 && /pages/.test(textSchematic.text),
  `${textSchematic.status} ${textSchematic.text.slice(0, 160)}`,
)

// A binary with no text layer is refused, but with a reason that says why.
const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48)])
const imageSchematic = await call('/api/dsh-wrenchbench/schematic', {
  method: 'POST',
  url: `/api/dsh-wrenchbench/schematic?id=${boardId}&name=scan.png`,
  body: image,
})
expect(
  'an image schematic is refused with a plain reason',
  imageSchematic.status === 422 && /OCR/i.test(imageSchematic.text),
  `${imageSchematic.status} ${imageSchematic.text.slice(0, 200)}`,
)

const wrongMethod = await call('/api/dsh-wrenchbench/import', { method: 'GET', url: '/api/dsh-wrenchbench/import' })
expect('a wrong method is refused', wrongMethod.status === 405, String(wrongMethod.status))

// --- asking the agent ------------------------------------------------------
//
// This route shipped broken once: it called sessionController.prompt() without
// the AbortSignal the admission contract requires, the service threw, and the
// panel showed nothing usable. The fakes below are deliberately strict — the
// controller refuses a call without a signal, exactly like the real one.
console.log('\n# ask the agent')

const prompts = []
services.agents = { roots: () => [{ id: 'session-1' }] }
services.sessionController = {
  async prompt(request, signal) {
    // Same guard the real service runs before admitting anything.
    const check = signal?.throwIfAborted
    if (typeof check !== 'function') throw new TypeError("Cannot read properties of undefined (reading 'throwIfAborted')")
    check.call(signal)
    prompts.push({ request, aborted: signal.aborted })
    return { accepted: true }
  },
}

const asked = await call('/api/dsh-wrenchbench/ask', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/ask',
  body: JSON.stringify({ question: 'is Net72 shorted to ground?', board: boardId }),
  headers: { 'content-type': 'application/json' },
})
expect(
  'a question is admitted into the live session',
  asked.status === 200 && asked.json?.accepted === true && asked.json?.sessionId === 'session-1',
  `${asked.status} ${asked.text.slice(0, 200)}`,
)
expect('the prompt carries a live AbortSignal', prompts.length === 1 && prompts[0].aborted === false, JSON.stringify(prompts))
expect(
  'the prompt names the board on the canvas',
  /board on the canvas/.test(prompts[0]?.request?.content?.[0]?.text ?? ''),
  (prompts[0]?.request?.content?.[0]?.text ?? '').slice(0, 160),
)
expect(
  'the question is queued rather than steered',
  prompts[0]?.request?.mode === 'queue' && typeof prompts[0]?.request?.requestId === 'string',
  JSON.stringify(prompts[0]?.request?.mode),
)

// A rejection has to reach the panel with its reason, not as a bare 500.
services.sessionController = {
  async prompt() {
    const error = new Error('another writer holds this session')
    error.code = 'session/writer-held'
    throw error
  },
}
const refused = await call('/api/dsh-wrenchbench/ask', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/ask',
  body: JSON.stringify({ question: 'ping', board: boardId }),
  headers: { 'content-type': 'application/json' },
})
expect(
  'a refused admission comes back with its reason',
  refused.status === 200 &&
    refused.json?.accepted === false &&
    refused.json?.reason === 'session/writer-held' &&
    /writer holds/.test(refused.json?.detail ?? ''),
  `${refused.status} ${refused.text.slice(0, 200)}`,
)

// No live agent at all is a normal state early in a session, not an error.
services.agents = { roots: () => [] , list: () => [] }
const noSession = await call('/api/dsh-wrenchbench/ask', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/ask',
  body: JSON.stringify({ question: 'ping', board: boardId }),
  headers: { 'content-type': 'application/json' },
})
expect(
  'no live session is reported as such, with a next step',
  noSession.json?.accepted === false && noSession.json?.reason === 'no-session' && /Send a message/.test(noSession.json?.detail ?? ''),
  noSession.text.slice(0, 200),
)

// A live child agent (no roots) must still receive the question.
services.sessionController = {
  async prompt(request, signal) {
    signal?.throwIfAborted?.()
    prompts.push({ request })
    return { accepted: true }
  },
}
services.agents = { roots: () => [], list: () => [{ id: 'child-9' }] }
const childAsk = await call('/api/dsh-wrenchbench/ask', {
  method: 'POST',
  url: '/api/dsh-wrenchbench/ask',
  body: JSON.stringify({ question: 'ping', board: boardId }),
  headers: { 'content-type': 'application/json' },
})
expect(
  'a live child agent is a valid target when no root is registered',
  childAsk.json?.sessionId === 'child-9',
  childAsk.text.slice(0, 160),
)
delete services.agents
delete services.sessionController

console.log('\n# cleanup')
const deleted = await call('/api/dsh-wrenchbench/board', {
  method: 'DELETE',
  url: `/api/dsh-wrenchbench/board?id=${boardId}`,
})
expect('delete removes the board', deleted.json?.removed === true, deleted.text)
const afterDelete = await call('/api/dsh-wrenchbench/boards')
expect('the library is empty again', afterDelete.json?.boards?.length === 0, String(afterDelete.json?.boards?.length))

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`)
console.log('registered tools:', tools.map((entry) => entry.name).join(', '))
console.log('registered routes:', routes.map((entry) => entry.path).join(', '))
console.log('library dir:', store.dataRoot, fs.existsSync(libraryDir))

try {
  fs.rmSync(libraryDir, { recursive: true, force: true })
} catch {
  // Best effort.
}

process.exitCode = failures.length === 0 ? 0 : 1
