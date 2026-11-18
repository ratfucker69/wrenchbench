/**
 * Client render test WITH a board mounted.
 *
 * `client.test.mjs` proves the panel survives a first render, but every branch
 * that needs data — the rail legend, the Triage suspects, the repair transcript
 * — sat behind effects that test skips, so none of it ever executed. That is
 * where a real fault would live: the legend reads `rails`, `railMap`, the
 * schematic candidates and the label editor, and a mistake in any of them throws
 * during render, which blanks the whole panel.
 *
 * So this test runs the bundle against a small hooks runtime (state, effects,
 * re-render) with `fetch` wired into the plugin's *real* host routes and a real
 * board on disk. It is an end-to-end render: board payload, rail labels, marks
 * and the conversation all travel through the shipping code paths.
 *
 * Run with `node test/client-board.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const libraryDir = path.join(os.tmpdir(), `wrenchbench-client-board-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/* ----------------------------------------------------------------- host side */

const { apply } = await import('../index.js')
const store = await import('../store.js')

const routes = []
apply(
  {
    webServer: { register: (route) => (routes.push(route), () => {}) },
    tools: { register: () => () => {} },
    effect: (fn) => (fn(), () => {}),
    get: () => undefined,
  },
  {},
)

const boardId = 'render-bench-0100'
const padsFor = (net, n) => Array.from({ length: n }, (_, i) => ({ net, i }))
void padsFor

const parts = ['N15900', 'N15923', 'R1', 'C1', 'C2'].map((refdes, index) => ({
  refdes,
  layer: 'top',
  smd: true,
  pins: 2,
  bbox: { x1: index * 4, y1: 0, x2: index * 4 + 2, y2: 2 },
}))
const pins = []
let pinIndex = 0
const push = (part, net, x) => pins.push({ x, y: 0, part, index: (pinIndex++ % 2) + 1, net, probe: null, layer: 'top' })
// N15900 owns most of the rail pads, N15923 a handful, and the rest decouple it.
for (let i = 0; i < 12; i += 1) push(0, 'Net73', i)
for (let i = 0; i < 4; i += 1) push(1, 'Net73', 20 + i)
for (let i = 0; i < 6; i += 1) push(2 + (i % 3), 'Net73', 40 + i)
for (let i = 0; i < 6; i += 1) push(0, 'GND', 60 + i)
for (let i = 0; i < 3; i += 1) push(0, 'Net9', 80 + i)
for (let i = 0; i < 2; i += 1) push(3, '+3V3', 90 + i)

const board = {
  format: 'brd',
  units: 'mm',
  outline: [],
  edges: [],
  parts,
  pins,
  nails: [],
  warnings: [],
  nets: [
    { name: 'Net73', pins: pins.map((p, i) => (p.net === 'Net73' ? i : -1)).filter((i) => i >= 0), power: true, ground: false },
    { name: 'GND', pins: pins.map((p, i) => (p.net === 'GND' ? i : -1)).filter((i) => i >= 0), power: false, ground: true },
    { name: 'Net9', pins: pins.map((p, i) => (p.net === 'Net9' ? i : -1)).filter((i) => i >= 0), power: true, ground: false },
    { name: '+3V3', pins: pins.map((p, i) => (p.net === '+3V3' ? i : -1)).filter((i) => i >= 0), power: true, ground: false },
  ],
  bounds: { minX: 0, minY: 0, maxX: 24, maxY: 2 },
  stats: { parts: parts.length, pins: pins.length, nets: 4, probes: 0, layers: 1 },
}

store.saveBoard({ id: boardId, name: 'Render Bench 010', sourceName: 'render.brd', format: 'brd', board, warnings: [] })
store.setRailLabel(boardId, 'Net73', '', {})
store.setRailLabel(boardId, 'Net9', 'PP1V8_RENDER', { source: 'manual' })
store.addObservation(boardId, { kind: 'short-to-ground', refdes: 'C1', note: '0.4 \u03a9 to GND' })
store.setAlias(boardId, 'C1', 'MLCC_RENDER')
store.writeFocus({ board: boardId, refdes: 'N15900', net: null, pin: null })
store.writeRepairSession(boardId, { sessionId: 'render-session', createdAt: new Date().toISOString() })

/** Fetch, routed into the host routes exactly as the browser would. */
const fetchLog = []
function hostFetch(url, init = {}) {
  fetchLog.push(`${init.method ?? 'GET'} ${url}`)
  const parsed = new URL(url, 'http://127.0.0.1')
  const route = routes.find((entry) => entry.path === parsed.pathname)
  if (!route) return Promise.reject(new Error(`the client called an unknown route: ${parsed.pathname}`))
  const payload = init.body
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(payload)])
  req.method = init.method ?? 'GET'
  req.url = `${parsed.pathname}${parsed.search}`
  req.headers = init.headers ?? {}
  req.destroy = () => {}
  const text = typeof payload === 'string' ? payload : ''
  return new Promise((resolve, reject) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value
      },
      writeHead(status, headers = {}) {
        this.statusCode = status
        Object.assign(this.headers, headers)
      },
      write(value) {
        chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)))
      },
      end(value) {
        if (value !== undefined) chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)))
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: this.statusCode >= 200 && this.statusCode < 300,
          status: this.statusCode,
          statusText: '',
          headers: { get: (name) => this.headers[String(name).toLowerCase()] ?? null },
          text: async () => body,
          json: async () => JSON.parse(body),
          body: null,
        })
      },
    }
    void text
    try {
      Promise.resolve(route.handler(req, res)).catch(reject)
    } catch (error) {
      reject(error)
    }
  })
}

/* --------------------------------------------------------------- hooks runtime */

/**
 * A small React: ordered hook slots per component, a re-render loop, and effects
 * that run after each commit when their dependencies change.
 */
function makeHookReact() {
  const tree = { frames: [], effects: [], dirty: false, pending: [] }
  let rendering = null
  const componentStack = []

  const element = (type, props, children) => ({
    type,
    props: { ...(props ?? {}), children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children },
    children,
  })

  function frameKey(component, index) {
    const path = componentStack.join('/')
    return `${path}#${component?.name ?? 'anon'}:${index}`
  }

  function slot(initial) {
    const component = rendering.component
    const key = frameKey(component, rendering.index)
    rendering.index += 1
    if (!tree.frames[key]) tree.frames[key] = { value: typeof initial === 'function' ? initial() : initial, deps: undefined }
    return tree.frames[key]
  }

  function useState(initial) {
    const entry = slot(initial)
    const setState = (next) => {
      const value = typeof next === 'function' ? next(entry.value) : next
      if (Object.is(value, entry.value)) return
      entry.value = value
      tree.dirty = true
    }
    return [entry.value, setState]
  }

  function useReducer(reducer, initial, init) {
    const entry = slot(init ? init(initial) : initial)
    return [entry.value, (action) => {
      entry.value = reducer(entry.value, action)
      tree.dirty = true
    }]
  }

  function useRef(initial) {
    const holder = slot({ current: initial === undefined ? null : initial, ref: true })
    if (!holder.ref) {
      holder.ref = true
      holder.current = initial === undefined ? null : initial
    }
    return holder
  }

  function useMemo(factory, deps) {
    const entry = slot(undefined)
    if (!sameDeps(entry.deps, deps)) {
      entry.deps = deps
      entry.value = factory()
    }
    return entry.value
  }

  function useCallback(callback, deps) {
    return useMemo(() => callback, deps)
  }

  function useEffectImpl(fn, deps) {
    const entry = slot(undefined)
    if (!sameDeps(entry.deps, deps)) {
      entry.deps = deps
      entry.run = fn
      entry.queued = true
      tree.effects.push(entry)
    }
  }

  function sameDeps(a, b) {
    if (!a || !b) return false
    if (a.length !== b.length) return false
    return a.every((value, i) => Object.is(value, b[i]))
  }

  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(patch, callback) {
      const next = typeof patch === 'function' ? patch(this.state) : patch
      this.state = { ...this.state, ...next }
      this.__dirty = true
      tree.dirty = true
      if (typeof callback === 'function') callback()
    }
  }

  function render(node, instance) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map((child) => render(child, instance))
    if (typeof node.type === 'function') {
      const isClass = node.type.prototype && typeof node.type.prototype.render === 'function'
      if (isClass) {
        const key = `${componentStack.join('/')}#class:${node.type.name}`
        let target = tree.instances?.[key]
        if (!target) {
          target = new node.type(node.props)
          tree.instances = tree.instances ?? {}
          tree.instances[key] = target
        }
        target.props = node.props
        target.state = target.state ?? {}
        componentStack.push(node.type.name)
        try {
          return render(target.render(), target)
        } finally {
          componentStack.pop()
        }
      }
      const parent = rendering
      rendering = { component: node.type, index: 0 }
      componentStack.push(node.type.name || 'anon')
      try {
        return render(node.type(node.props), instance)
      } finally {
        componentStack.pop()
        rendering = parent
      }
    }
    return { type: node.type, props: node.props }
  }

  return {
    React: {
      Component,
      createElement: (type, props, ...children) => element(type, props, children),
      Fragment: 'Fragment',
      useState,
      useReducer,
      useRef,
      useMemo,
      useCallback,
      useEffect: useEffectImpl,
      useLayoutEffect: useEffectImpl,
      useContext: () => null,
      createContext: (value) => ({ Provider: 'Provider', _value: value }),
    },
    /** Render until the tree settles, running queued effects after each pass. */
    async mount(root) {
      let result = null
      for (let pass = 0; pass < 12; pass += 1) {
        tree.dirty = false
        tree.effects = []
        rendering = { component: null, index: 0 }
        componentStack.length = 0
        result = render(root, null)
        // Commit: run this pass's effects, then let their promises settle.
        const queued = tree.effects.filter((entry) => entry.queued)
        for (const entry of queued) {
          entry.queued = false
          // React disposes the previous run before re-running an effect. Without
          // that, the conversation poll stacks timers and the process never exits.
          if (typeof entry.dispose === 'function') {
            try {
              entry.dispose()
            } catch {
              // A disposer that throws must not break the mount.
            }
            entry.dispose = undefined
          }
          const dispose = entry.run()
          if (typeof dispose === 'function') entry.dispose = dispose
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
        if (!tree.dirty) break
      }
      return result
    },
    unmount() {
      for (const entry of Object.values(tree.frames)) {
        if (typeof entry.dispose === 'function') entry.dispose()
      }
    },
  }
}

/* ---------------------------------------------------------------- bundle load */

function loadBundle(fetchImpl, React) {
  let spec = null
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    // The panel polls the agent's canvas focus every 2 s. Let the first poll
    // actually run, once, so a focus the agent set is adopted in the test the
    // same way it is on the bench; a real interval would keep the process alive.
    // The panel polls the agent's canvas focus every 2 s. Let a few polls run so a
    // focus the agent set is adopted as it is on the bench, but cap them: a real
    // interval would keep the process alive.
    setInterval: (fn, ms) => {
      let fired = 0
      const tick = () => {
        fired += 1
        if (fired > 8) return
        try {
          fn()
        } catch {
          // The panel swallows poll failures too.
        }
        setTimeout(tick, Math.min(ms ?? 2000, 10))
      }
      return setTimeout(tick, Math.min(ms ?? 2000, 10))
    },
    clearInterval: (id) => clearTimeout(id),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    Promise,
    URL,
    fetch: fetchImpl,
    navigator: { clipboard: { writeText: async () => {} } },
    devicePixelRatio: 1,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    document: {
      activeElement: null,
      querySelector: () => null,
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, getContext: () => null }),
      body: { appendChild() {}, removeChild() {} },
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = { load: (loaded) => (spec = loaded) }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(spec, 'the bundle did not register with the module loader')

  const plugin = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
  const registrations = []
  plugin.apply({
    slots: { inject: (_slot, cb) => cb(), register: (...args) => (registrations.push(args), { dispose() {} }) },
    locale: { register: () => ({ dispose() {} }), bind: () => (key) => key },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get: () => undefined,
  })
  return registrations
}

const runtime = makeHookReact()
const registrations = loadBundle(hostFetch, runtime.React)
const panel = registrations.find((args) => typeof args[1] === 'function' && args[0]?.name === 'main')?.[1]

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = node.props ?? {}
  const children = props.children ?? node.children
  // href matters: the export affordance is a link, not a button with a label.
  return [props.title, props['aria-label'], props.href, textOf(children)].filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------- the test */

/** Walk the rendered element tree for the first node the predicate accepts. */
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit) return hit
    }
    return null
  }
  if (node.props && predicate(node)) return node
  const children = node.props?.children
  return children === undefined ? null : findNode(children, predicate)
}

/**
 * The conversation route needs a session service, which this harness does not
 * have. Overriding that one route keeps the rest of the panel on real code while
 * letting the Agent tab render a transcript and a blocked turn.
 */
const threadFixture = {
  sessionId: 'render-session',
  running: true,
  pending: null,
  messages: [
    { role: 'user', text: 'which rail is Net73?', time: 1 },
    { role: 'assistant', text: 'Net73 is VDDCR_GFX, 1.0 V.', time: 2 },
    { role: 'tool', text: 'wrenchbench_net', time: 3 },
  ],
  unavailable: null,
}
const conversationRoute = routes.find((entry) => entry.path === '/api/dsh-wrenchbench/conversation')
if (conversationRoute) {
  const realHandler = conversationRoute.handler
  conversationRoute.handler = (req, res) =>
    /conversation/.test(req.url ?? '')
      ? Promise.resolve().then(() => {
          const body = JSON.stringify(threadFixture)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
          res.end(body)
        })
      : realHandler(req, res)
}

let tree = null

await check('the panel mounts and reaches a settled state with a board loaded', async () => {
  assert.ok(panel, 'no main panel component registered')
  tree = await runtime.mount(panel({}))
  assert.ok(tree, 'the panel rendered nothing')
})

await check('the loaded board is drawn, with its real counts', () => {
  const text = textOf(tree)
  assert.match(text, /Render Bench 010/, 'the board name never reached the panel')
  assert.match(text, new RegExp(`${pins.length}`), 'the pad count is missing')
})

await check('the rail legend renders the labelled rail and its net', () => {
  const text = textOf(tree)
  assert.match(text, /PP1V8_RENDER/, 'the rail label did not reach the legend')
  assert.match(text, /Net9/, 'the legend does not name the net behind the label')
})

await check('the legend also lists the unnamed bulk net, so nothing hides', () => {
  const text = textOf(tree)
  assert.match(text, /Net73/, 'the biggest unnamed net is missing from the legend')
})

await check('a recorded mark reaches the panel', () => {
  const text = textOf(tree)
  assert.match(text, /MLCC_RENDER|C1/, 'the marked part is not shown')
})

await check('the schematic upload affordance is present for a board without one', () => {
  const text = textOf(tree)
  assert.match(text, /PDF|schematic/i, 'no schematic affordance rendered')
})

await check('the export link is rendered for each board in the library', () => {
  const text = textOf(tree)
  assert.match(text, /export\?id=render-bench-0100/, 'the CSV export link is missing')
})

await check('the Agent tab draws the transcript, below the input', async () => {
  const agentTab = findNode(tree, (node) => node.type === 'button' && node.props?.children === 'tab.agent')
  assert.ok(agentTab, 'no Agent tab button')
  agentTab.props.onClick()
  tree = await runtime.mount(panel({}))
  const text = textOf(tree)
  assert.match(text, /which rail is Net73/, 'the question is not drawn')
  assert.match(text, /VDDCR_GFX/, 'the answer is not drawn')
  assert.match(text, /wrenchbench_net/, 'the tool line is not drawn')

  // The transcript must sit after the textarea in document order: the answer
  // belongs under the box the technician types in.
  const order = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node.type === 'textarea') order.push('input')
    const own = node.props?.children
    if (typeof own === 'string' && own.includes('VDDCR_GFX')) order.push('answer')
    walk(own)
  }
  walk(tree)
  assert.deepEqual(order.slice(0, 2), ['input', 'answer'], `the transcript is not below the input (${order.join(',')})`)
})

await check('a blocked turn draws its options as buttons', async () => {
  threadFixture.pending = { question: 'Rail present?', header: 'Rail', options: ['0 V', '3.3 V', 'not reachable'] }
  // Leave the tab and come back: the poll effect re-runs on a tab change, which
  // is how a real panel learns about a turn that became blocked while it sat.
  const boardTab = findNode(tree, (node) => node.type === 'button' && node.props?.children === 'tab.board')
  assert.ok(boardTab, 'no Board tab button')
  boardTab.props.onClick()
  tree = await runtime.mount(panel({}))
  const agentAgain = findNode(tree, (node) => node.type === 'button' && node.props?.children === 'tab.agent')
  agentAgain.props.onClick()
  tree = await runtime.mount(panel({}))
  const text = textOf(tree)
  assert.match(text, /Rail present\?/, 'the pending question is not drawn')
  // The key is what makes these buttons the answer options: the same label can
  // appear elsewhere in the panel (the rail legend offers "3.3 V" as a name).
  const option = findNode(tree, (node) => node.type === 'button' && node.props?.key === 'opt-1')
  assert.ok(option, 'the options are not drawn as buttons')
  // Clicking one sends that label; the fixture records the call.
  let sent = null
  const askRoute = routes.find((entry) => entry.path === '/api/dsh-wrenchbench/ask')
  const realAsk = askRoute.handler
  askRoute.handler = (req, res) => {
    sent = req
    const body = JSON.stringify({ accepted: true, sessionId: 'render-session' })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  // What did the panel do with the click? Errors are drawn, so look at both.
  const clicked = option.props.onClick()
  if (clicked && typeof clicked.then === 'function') await clicked
  await new Promise((resolve) => setTimeout(resolve, 50))
  askRoute.handler = realAsk
  assert.ok(sent, 'clicking an option sent nothing')
  threadFixture.pending = null
})

await check('an IC’s pins are numbered 1..N in the inspector', async () => {
  // N15900 is the fixture's big part: focus lands on it, so its pin list is what
  // the inspector draws.
  const text = textOf(tree)
  const pairs = [...text.matchAll(/(\d+)\/(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])])
  assert.ok(pairs.length > 0, 'no pin numbers rendered for the selected IC')
  const counts = new Set(pairs.map(([, count]) => count))
  assert.equal(counts.size, 1, 'the pin count is not stable across rows')
  const total = [...counts][0]
  assert.ok(total >= 6, `expected an IC-sized pin count, got ${total}`)
  const numbers = pairs.map(([number]) => number)
  assert.equal(numbers[0], 1, 'pins do not start at 1')
  assert.equal(Math.max(...numbers), Math.min(total, 40), 'pins do not run up to the pin count (or the row cap)')
  // The vendor pad index is kept, because that is what marks and tools record.
  assert.match(text, /pad index/, 'the pad index is no longer exposed')
})

await check('the command list is one click away and lists the gestures', async () => {
  const toggle = findNode(tree, (node) => node.props?.title === 'hints.open')
  assert.ok(toggle, 'no hint toggle in the panel')
  assert.equal(toggle.props['aria-expanded'], 'false', 'the list should start closed')
  toggle.props.onClick()
  tree = await runtime.mount(panel({}))
  const text = textOf(tree)
  for (const key of ['hints.onBoard', 'hints.rightclick', 'hints.legend', 'hints.csv', 'hints.trash', 'hints.onAgent', 'hints.tools']) {
    assert.match(text, new RegExp(key), `the command list does not show ${key}`)
  }
  // The tool names are identifiers, not prose: they must survive translation.
  assert.match(text, /find · component · net/, 'the tool list is missing')
  const opened = findNode(tree, (node) => node.props?.title === 'hints.open')
  assert.equal(opened.props['aria-expanded'], 'true', 'the toggle does not report open state')
  opened.props.onClick()
  tree = await runtime.mount(panel({}))
  assert.doesNotMatch(textOf(tree), /hints\.rightclick/, 'the list cannot be closed again')
})

await check('the harness surfaces a render fault instead of swallowing it', async () => {
  // If a throw during render were swallowed, every check above would pass on a
  // blank panel — which is exactly the bug this file exists to catch.
  const boom = runtime.React.createElement(function Boom() {
    throw new Error('render-fault-selftest')
  }, null)
  let caught = null
  try {
    await runtime.mount(boom)
  } catch (error) {
    caught = error
  }
  assert.match(String(caught?.message), /render-fault-selftest/, 'a render throw vanished')
})

runtime.unmount()
store.deleteBoard(boardId)
try {
  fs.rmSync(libraryDir, { recursive: true, force: true })
} catch {
  // best effort
}

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} RENDER CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`RENDER CHECKS PASS (${passed})`)
// The panel polls while the Agent tab is open — a feature of the panel, not of
// the test. End the process rather than waiting for a timer that will rearm.
process.exit(0)
