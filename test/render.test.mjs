/**
 * Renderer and locale invariants.
 *
 * The canvas is drawn inside a module factory, so there is nothing to import
 * and call. These checks are structural instead: they pin the decisions that
 * were expensive to get right, so a later refactor cannot quietly undo them —
 * pads that shrink back to unclickable dots, rail colouring that stops being on
 * by default, an i18n key that loses its string.
 *
 * Run with `node test/render.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'))
const zh = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'))

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

console.log('\npads and hit targets')
check('pads are drawn at a clickable screen size', () => {
  // 3.1 screen px half-size, not the 1.5 that put a 3 px dot on screen.
  assert.match(client, /clamp\(3\.1 \/ Math\.max\(zoom, 1e-6\)/)
})
check('the click grab radius is larger than the pad', () => {
  assert.match(client, /let bestDistance = 12/)
})
check('hover uses its own grab radius', () => {
  assert.match(client, /let nearestDistance = 9/)
})
check('pads are batched per colour rather than filled one by one', () => {
  assert.match(client, /const buckets = new Map\(\)/)
  assert.match(client, /for \(const \[colour, points\] of buckets\)/)
})
check('pad projection is cached per view', () => {
  assert.match(client, /const screenPinsRef = React\.useRef/)
  assert.match(client, /screenPinsRef\.current = \{ key, xs, ys, count: pins\.length \}/)
})
check('a small package still has a body margin to click', () => {
  assert.match(client, /const margin = Math\.min\(8 \/ Math\.max\(currentView\.zoom, 1e-6\)/)
})

console.log('\ncomponent symbols')
check('the symbol painter exists and is used', () => {
  assert.match(client, /function paintPartSymbol\(/)
  assert.match(client, /paintPartSymbol\(\s*\n?\s*context,/)
})
check('families come from the designator prefix', () => {
  assert.match(client, /function familyOfRefdes\(/)
  for (const prefix of ["prefix === 'C'", "prefix === 'R'", "prefix === 'L'", "prefix === 'D'", "prefix === 'Q'"]) {
    assert.ok(client.includes(prefix), `missing family rule ${prefix}`)
  }
})
check('two-terminal parts get end caps, not just a box', () => {
  assert.match(client, /End caps\./)
  assert.match(client, /context\.fillStyle = terminal/)
})
check('the cathode band and coil detail are drawn', () => {
  assert.match(client, /Cathode band near one end\./)
  assert.match(client, /Three coil bumps along the outer edge\./)
})
check('chips get a pin-1 dot and pin fingers', () => {
  assert.match(client, /Pin-1 dot, then pin fingers/)
})
check('tiny parts fall back to a block instead of a smear of outlines', () => {
  assert.match(client, /if \(Math\.max\(screenWidth, screenHeight\) < 9\)/)
})
check('off-screen parts are culled before a path is built', () => {
  assert.match(client, /if \(screenWidth < 3 && screenHeight < 3\) continue/)
})

console.log('\ndefaults')
check('rail colouring is on by default', () => {
  assert.match(client, /railColour: true,/)
})
check('net wiring and pads stay on by default', () => {
  assert.match(client, /showPads: true,/)
  assert.match(client, /showNetWiring: true,/)
})

console.log('\nlocale parity')
const used = new Set([...client.matchAll(/t\('([A-Za-z][\w.]*)'\)/g)].map((match) => match[1]))
check('every t() key has an English string', () => {
  const missing = [...used].filter((key) => !en[key] && key !== 'layout')
  assert.deepEqual(missing, [])
})
check('every t() key has a Chinese string', () => {
  const missing = [...used].filter((key) => !zh[key] && key !== 'layout')
  assert.deepEqual(missing, [])
})
check('both locale files define the same key set', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})
check('no locale string is empty', () => {
  // `meta` is the bundle's own title/description block, not a display string.
  const empty = Object.entries(en)
    .filter(([key, value]) => key !== 'meta' && typeof value === 'string' && value.trim().length === 0)
    .map(([key]) => key)
  assert.deepEqual(empty, [])
})

console.log(failures.length === 0 ? `\nRENDER CHECKS PASS (${passed})` : `\n${failures.length} RENDER CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
