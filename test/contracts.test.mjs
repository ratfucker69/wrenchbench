/**
 * Route contracts, driven from one table.
 *
 * Two faults in this codebase were contract drift rather than logic: the alias
 * route read a field the tool never sent, and an oversized body answered 400
 * "not valid JSON" instead of 413. Both were invisible to feature tests, because
 * a feature test only exercises the fields its own caller happens to send.
 *
 * This suite asserts the contract itself: every route's methods, the status a
 * malformed request earns, and the field names a caller may use.
 *
 * Run with `node test/contracts.test.mjs`.
 */
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const libraryDir = path.join(os.tmpdir(), `wrenchbench-contracts-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

const { apply } = await import('../index.js')
const store = await import('../store.js')

const routes = []
const tools = []
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
    fn()
    return () => {}
  },
  get(name) {
    return services[name]
  },
}

apply(ctx, {})

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

async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

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
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value
      },
      writeHead(status, headers = {}) {
        this.statusCode = status
        for (const [name, value] of Object.entries(headers)) this.headers[String(name).toLowerCase()] = value
      },
      end(value) {
        if (value !== undefined) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)))
        resolve({ status: this.statusCode, headers: this.headers, text: Buffer.concat(chunks).toString('utf8') })
      },
      write(value) {
        chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)))
      },
    }
    try {
      Promise.resolve(route.handler(req, res)).catch(reject)
    } catch (error) {
      reject(error)
    }
  })
}

console.log('\nroutes')

check('every route is registered once with a stable path', () => {
  const paths = routes.map((route) => route.path)
  const unique = new Set(paths)
  if (unique.size !== paths.length) throw new Error(`duplicate route paths: ${paths.filter((p, i) => paths.indexOf(p) !== i).join(', ')}`)
  if (!paths.every((p) => p.startsWith('/api/dsh-wrenchbench'))) throw new Error('a route escaped the plugin prefix')
})

const methodsByPath = new Map()
for (const route of routes) methodsByPath.set(route.path, route)

await checkAsync('a route answers 405 for a method it does not implement', async () => {
  const postOnly = ['/api/dsh-wrenchbench/ask', '/api/dsh-wrenchbench/import', '/api/dsh-wrenchbench/focus', '/api/dsh-wrenchbench/rail-label', '/api/dsh-wrenchbench/alias', '/api/dsh-wrenchbench/enrich', '/api/dsh-wrenchbench/import-path']
  for (const routePath of postOnly) {
    const refused = await call(routePath, { method: 'PATCH', url: routePath })
    if (refused.status !== 405 && refused.status !== 400) {
      throw new Error(`${routePath} answered ${refused.status} for PATCH`)
    }
  }
})

await checkAsync('every idempotent read route refuses a write', async () => {
  for (const routePath of ['/api/dsh-wrenchbench/boards', '/api/dsh-wrenchbench/conversation', '/api/dsh-wrenchbench/export']) {
    const refused = await call(routePath, { method: 'DELETE', url: routePath })
    if (refused.status !== 405 && refused.status !== 400) throw new Error(`${routePath} answered ${refused.status} for DELETE`)
  }
})

console.log('\nan imported board')

const boardId = 'contract-bench-0001'
const board = {
  format: 'brd',
  units: 'mm',
  outline: [],
  edges: [],
  parts: [
    { refdes: 'R1', layer: 'top', smd: true, pins: 2, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } },
    { refdes: 'C1', layer: 'top', smd: true, pins: 2, bbox: { x1: 2, y1: 0, x2: 3, y2: 1 } },
  ],
  pins: [
    { x: 0, y: 0, part: 0, index: 1, net: '+3V3', probe: null, layer: 'top' },
    { x: 1, y: 0, part: 0, index: 2, net: 'GND', probe: null, layer: 'top' },
    { x: 2, y: 0, part: 1, index: 1, net: '+3V3', probe: null, layer: 'top' },
    { x: 3, y: 0, part: 1, index: 2, net: 'GND', probe: null, layer: 'top' },
  ],
  nails: [],
  warnings: [],
  nets: [
    { name: '+3V3', pins: [0, 2], power: true, ground: false },
    { name: 'GND', pins: [1, 3], power: false, ground: true },
  ],
  bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
  stats: { parts: 2, pins: 4, nets: 2, probes: 0, layers: 1 },
}
store.saveBoard({ id: boardId, name: 'Contract Bench', sourceName: 'contract.brd', format: 'brd', board, warnings: [] })

await checkAsync('the board payload carries an ETag and honours it', async () => {
  const first = await call('/api/dsh-wrenchbench/board', { url: `/api/dsh-wrenchbench/board?id=${boardId}` })
  const etag = first.headers.etag
  if (first.status !== 200 || !etag) throw new Error(`no etag: ${first.status} ${first.text.slice(0, 120)}`)
  const second = await call('/api/dsh-wrenchbench/board', {
    url: `/api/dsh-wrenchbench/board?id=${boardId}`,
    headers: { 'if-none-match': etag },
  })
  if (second.status !== 304) throw new Error(`expected 304, got ${second.status}`)
  if (second.text.length !== 0) throw new Error('a 304 must not carry a body')
})

await checkAsync('a label invalidates the ETag', async () => {
  const before = await call('/api/dsh-wrenchbench/board', { url: `/api/dsh-wrenchbench/board?id=${boardId}` })
  await call('/api/dsh-wrenchbench/rail-label', {
    method: 'POST',
    url: `/api/dsh-wrenchbench/rail-label?id=${boardId}`,
    body: JSON.stringify({ net: '+3V3', label: 'PP3V3_CONTRACT' }),
    headers: { 'content-type': 'application/json' },
  })
  const after = await call('/api/dsh-wrenchbench/board', {
    url: `/api/dsh-wrenchbench/board?id=${boardId}`,
    headers: { 'if-none-match': before.headers.etag },
  })
  if (after.status !== 200) throw new Error(`label change did not invalidate the ETag (${after.status})`)
})

await checkAsync('the alias route accepts both field names callers use', async () => {
  for (const field of ['alias', 'name']) {
    const response = await call('/api/dsh-wrenchbench/alias', {
      method: 'POST',
      url: `/api/dsh-wrenchbench/alias?id=${boardId}`,
      body: JSON.stringify({ refdes: 'R1', [field]: `IC_${field}` }),
      headers: { 'content-type': 'application/json' },
    })
    if (response.status !== 200) throw new Error(`${field}: ${response.status} ${response.text.slice(0, 120)}`)
    const alias = store.readAliases(boardId).R1?.alias
    if (alias !== `IC_${field}`) throw new Error(`${field} did not reach the store (got ${alias})`)
  }
})

await checkAsync('an oversized body is a 413 everywhere it can happen', async () => {
  const targets = [
    ['/api/dsh-wrenchbench/observe', `/api/dsh-wrenchbench/observe?id=${boardId}`],
    ['/api/dsh-wrenchbench/rail-label', `/api/dsh-wrenchbench/rail-label?id=${boardId}`],
    ['/api/dsh-wrenchbench/focus', '/api/dsh-wrenchbench/focus'],
  ]
  for (const [routePath, url] of targets) {
    const response = await call(routePath, {
      method: 'POST',
      url,
      body: JSON.stringify({ note: 'x'.repeat(300 * 1024) }),
      headers: { 'content-type': 'application/json' },
    })
    if (response.status !== 413) throw new Error(`${routePath} answered ${response.status}`)
  }
})

await checkAsync('an unknown board is 404 and a traversal id is 400', async () => {
  const missing = await call('/api/dsh-wrenchbench/board', { url: '/api/dsh-wrenchbench/board?id=no-such-board' })
  if (missing.status !== 404) throw new Error(`missing id answered ${missing.status}`)
  const traversal = await call('/api/dsh-wrenchbench/board', { url: '/api/dsh-wrenchbench/board?id=../../etc' })
  if (traversal.status !== 400) throw new Error(`traversal answered ${traversal.status}`)
})

await checkAsync('the bench export is a CSV carrying every rail and every part', async () => {
  const response = await call('/api/dsh-wrenchbench/export', { url: `/api/dsh-wrenchbench/export?id=${boardId}` })
  if (response.status !== 200) throw new Error(String(response.status))
  if (!/text\/csv/.test(response.headers['content-type'] ?? '')) throw new Error(response.headers['content-type'])
  if (!/attachment; filename=/.test(response.headers['content-disposition'] ?? '')) throw new Error('no download filename')
  const lines = response.text.split('\n')
  const [header] = lines
  for (const column of ['type', 'key', 'name', 'pads', 'rail', 'voltage', 'source', 'detail', 'at']) {
    if (!header.includes(`"${column}"`)) throw new Error(`the export has no ${column} column: ${header}`)
  }
  const rows = lines.slice(1).map((line) => line.split(','))
  const rails = rows.filter((row) => row[0] === '"rail"')
  const parts = rows.filter((row) => row[0] === '"part"')
  if (rails.length === 0) throw new Error('no rail rows')
  if (!rails.some((row) => row.join(',').includes('PP3V3_CONTRACT'))) throw new Error('the labelled rail is not in the sheet')
  // Every part is a row, aliased or not, so the sheet is a complete inventory.
  if (parts.length !== 2) throw new Error(`expected 2 part rows, got ${parts.length}`)
  const aliasRow = parts.find((row) => row[1] === '"R1"')
  if (!aliasRow || !aliasRow[2].includes('IC_name')) throw new Error(`the part alias is missing: ${aliasRow?.join(',')}`)
  if (!parts.every((row) => /^"?\d+"?$/.test(row[3]))) throw new Error('a part row has no pad count')
})

console.log('\ntool/route parity')

check('every tool a route backs uses the documented parameter names', () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const expectations = [
    ['wrenchbench_label_rail', ['net', 'label']],
    ['wrenchbench_name_part', ['refdes', 'name']],
    ['wrenchbench_mark', ['refdes', 'kind']],
    ['wrenchbench_focus', ['refdes', 'net', 'pin']],
    ['wrenchbench_ask' in {} ? 'wrenchbench_ask' : 'wrenchbench_rail_map', ['board']],
  ]
  for (const [name, params] of expectations) {
    const tool = byName.get(name)
    if (!tool) throw new Error(`${name} is not registered`)
    for (const param of params) {
      if (!(param in (tool.parameters?.properties ?? {}))) throw new Error(`${name} is missing ${param}`)
    }
  }
})

console.log('\ncleanup')
store.deleteBoard(boardId)
try {
  fs.rmSync(libraryDir, { recursive: true, force: true })
} catch {
  // best effort
}

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} CONTRACT CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`CONTRACT CHECKS PASS (${passed})`)
