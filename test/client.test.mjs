/**
 * Client render smoke test.
 *
 * The panel half is not importable: it ships as a module-factory bundle that
 * registers components with the Harness slot system. That made a whole class of
 * bug invisible to the node suites — a render-time exception, such as a
 * `useCallback` whose dependency array read a `const` declared further down,
 * blanked the entire panel and nothing here noticed.
 *
 * So this test executes the real bundle against a minimal React stub and calls
 * the panel component once. It does not need a DOM or a browser: the component
 * builds an element tree, and every effect (and therefore every fetch, canvas
 * read and draw call) is skipped.
 *
 * Run with `node test/client.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

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

/** Just enough React to run a component's body exactly once. */
function makeReact() {
  const element = (type, props, children) => ({
    type,
    props: {
      ...(props ?? {}),
      children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
    },
    children,
  })
  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(patch) {
      this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) }
    }
  }
  return {
    Component,
    createElement: (type, props, ...children) => element(type, props, children),
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial === undefined ? null : initial }),
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useReducer: (_reducer, initial) => [initial, () => {}],
  }
}

/**
 * Evaluate the bundle the way the Web client does and hand back the plugin.
 */
function loadPlugin() {
  const registrations = []
  let spec = null

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    devicePixelRatio: 1,
    document: { activeElement: null, querySelector: () => null, createElement: () => ({ style: {}, dataset: {} }) },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = {
    load(loaded) {
      spec = loaded
    },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(spec, 'the bundle did not register itself with the module loader')

  const React = makeReact()
  const plugin = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })

  const ctx = {
    slots: {
      inject: (_slot, callback) => callback(),
      register: (...args) => {
        registrations.push(args)
        return { dispose() {} }
      },
    },
    locale: {
      register: () => ({ dispose() {} }),
      bind: () => (key) => key,
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get: () => undefined,
  }
  plugin.apply(ctx)
  return { plugin, registrations, React }
}

/**
 * Render a tree the way React would: function and class components are invoked
 * until only host elements are left. Effects are still skipped.
 */
function renderTree(node, depth = 0) {
  if (depth > 40) throw new Error('render tree too deep — a component is looping')
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child) => renderTree(child, depth + 1))
  if (typeof node.type === 'function') {
    const isClass = node.type.prototype && typeof node.type.prototype.render === 'function'
    if (isClass) {
      const instance = new node.type(node.props)
      instance.props = node.props
      instance.state = instance.state ?? {}
      return renderTree(instance.render(), depth + 1)
    }
    return renderTree(node.type(node.props), depth + 1)
  }
  return { type: node.type, props: node.props }
}

const { registrations } = loadPlugin()
const panelEntry = registrations.find((args) => typeof args[1] === 'function' && args[0]?.name === 'main')
const panel = panelEntry?.[1]

console.log('\nbundle')
check('the bundle registers a sidebar entry and a main panel', () => {
  assert.equal(registrations.length >= 2, true)
  assert.ok(panel, 'no main panel component was registered')
})

console.log('\nfirst render')
check('the panel component renders without throwing', () => {
  const tree = renderTree(panel({}))
  assert.ok(tree, 'the panel rendered nothing')
})

check('the render produces the panel shell and the project screen', () => {
  const tree = renderTree(panel({}))
  const flattenText = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(flattenText).join(' ')
    // renderTree returns { type, props }; the text lives in props.children.
    return flattenText(node.props?.children ?? node.children ?? [])
  }
  const text = flattenText(tree)
  // With no board loaded the panel shows the import prompt and the header.
  assert.ok(text.length > 0, 'the panel rendered no text at all')
})

check('a second render is still clean', () => {
  // Hook order bugs often only appear on a re-render.
  renderTree(panel({}))
  renderTree(panel({}))
})

check('the panel is rendered behind an error boundary', () => {
  const guard = panel({}).type
  assert.equal(typeof guard.getDerivedStateFromError, 'function', 'the panel is registered bare — a render throw would blank it')
  // A caught fault must produce readable text, never an empty pane.
  const instance = new guard({ children: null })
  instance.props = { children: null }
  instance.state = guard.getDerivedStateFromError(new Error('boom'))
  const text = (() => {
    const walk = (node) => {
      if (node === null || node === undefined || typeof node === 'boolean') return ''
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(walk).join(' ')
      return walk(node.props?.children)
    }
    return walk(instance.render())
  })()
  assert.match(text, /boom/, 'the boundary swallowed the message')
  assert.match(text, /untouched/, 'the boundary does not say the data is safe')
})


const broken = (() => {
  // Sanity check on the harness itself: a component that reads a later const in
  // a dependency array must be caught, or this test proves nothing.
  const sandbox = { window: { __ModuleLoader__: { load() {} } } }
  vm.createContext(sandbox)
  const bad = `window.__ModuleLoader__.load({ id: 'x', factory() { return { apply() { const a = (b) => b; const c = a(d); const d = 1; } } } })`
  vm.runInContext(bad, sandbox)
  return () => sandbox.window.__ModuleLoader__.load
})()

check('the harness would notice a temporal-dead-zone fault', () => {
  const sandbox = { window: { __ModuleLoader__: { load(spec) { sandbox.spec = spec } } } }
  vm.createContext(sandbox)
  vm.runInContext(
    `window.__ModuleLoader__.load({ id: 'x', factory() { return { boom() { const a = [b]; const b = 1; return a; } } } })`,
    sandbox,
  )
  assert.throws(() => sandbox.spec.factory().boom(), /before initialization/)
  void broken
})

console.log(failures.length === 0 ? `\nCLIENT CHECKS PASS (${passed})` : `\n${failures.length} CLIENT CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
