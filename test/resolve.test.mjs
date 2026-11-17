/**
 * Natural-language resolution tests.
 *
 * The point of this module is that a technician can describe a problem in
 * English — "the big chip near the CPU", "290 pad chip", "shorted cap" — and the
 * agent gets *real candidates from the board* instead of inventing a refdes.
 *
 * Equally important is what it refuses to do: a description that names only a
 * family, or a supply that this board cannot possibly answer, must come back
 * with an explanation rather than a confident wrong part.
 *
 * Run with `node test/resolve.test.mjs`.
 */
import assert from 'node:assert/strict'
import { resolveQuery } from '../resolve.js'

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

const part = (refdes, pins, value, x) => ({
  refdes,
  pins,
  value,
  layer: 'top',
  smd: true,
  bbox: { x1: x, y1: 0, x2: x + 2, y2: 2 },
})

/**
 * A board with the shapes the descriptions refer to:
 *   N1  — 290-pad SoC, marked CXD90061GG, named IC5006 by the schematic
 *   C1..C3 — three caps on the same rail, spread out
 *   R1  — a two-pad resistor
 *   L1  — an inductor next to the SoC
 */
function fixtureBoard() {
  const parts = [
    part('N1', 290, 'CXD90061GG', 0),
    part('C1', 2, '0.1u', 30),
    part('C2', 2, '0.1u', 60),
    part('C3', 2, '1u', 90),
    part('R1', 2, '10k', 40),
    part('L1', 2, '4.7uH', 6),
  ]
  const pins = []
  const nets = []
  const addPin = (partIndex, net, x, y) => {
    pins.push({ x, y, part: partIndex, index: pins.length + 1, net, layer: 'top' })
  }
  for (let index = 0; index < 290; index += 1) addPin(0, index % 3 === 0 ? 'VDDCR_SOC' : `SO${index % 40}`, index, 0)
  addPin(1, 'VDDCR_SOC', 30, 0)
  addPin(1, 'GND', 31, 0)
  addPin(2, 'VDDCR_SOC', 60, 0)
  addPin(2, 'GND', 61, 0)
  addPin(3, 'VDDCR_SOC', 90, 0)
  addPin(3, 'GND', 91, 0)
  addPin(4, 'VDDCR_SOC', 40, 0)
  addPin(4, 'BOOT', 41, 0)
  addPin(5, 'VDDCR_SOC', 6, 0)
  addPin(5, 'SW_NODE', 7, 0)

  const byNet = new Map()
  pins.forEach((pin, index) => {
    if (!byNet.has(pin.net)) byNet.set(pin.net, [])
    byNet.get(pin.net).push(index)
  })
  for (const [name, indices] of byNet) {
    nets.push({ name, pins: indices, ground: name === 'GND', power: false })
  }

  return {
    units: 'mm',
    parts,
    pins,
    nets,
    stats: { parts: parts.length, pins: pins.length, nets: nets.length },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 4 },
  }
}

const board = fixtureBoard()
const aliases = { N1: { alias: 'IC5006' } }

const find = (query, extra = {}) => resolveQuery(board, { query, aliases, limit: 6, ...extra })

console.log('\nexact identities')
check('a boardview label resolves to itself', () => {
  const result = find('N1')
  assert.equal(result.parts[0].refdes, 'N1')
  assert.ok(result.parts[0].score >= 100)
})
check('a schematic alias resolves to the boardview label', () => {
  const result = find('IC5006')
  assert.equal(result.parts[0].refdes, 'N1')
  assert.match(result.parts[0].reasons.join(' '), /IC5006/)
})
check('a marking on the part resolves it', () => {
  const result = find('CXD90061GG')
  assert.equal(result.parts[0].refdes, 'N1')
})

console.log('\ndescriptions, not names')
check('a stated pad count picks the right package', () => {
  const result = find('290 pad chip')
  assert.equal(result.parts[0].refdes, 'N1')
  assert.match(result.parts[0].reasons.join(' '), /290 pads/)
})
check('"biggest" ranks the largest first', () => {
  const result = find('the biggest package on the board')
  assert.equal(result.parts[0].refdes, 'N1')
})
check('"the coil near N1" finds the inductor beside it', () => {
  const result = find('the coil near N1')
  assert.equal(result.parts[0].refdes, 'L1')
})
check('the anchor part is not offered as its own answer', () => {
  const result = find('the coil near N1')
  assert.equal(result.parts.map((entry) => entry.refdes).includes('N1'), false)
})
check('a plural family word resolves', () => {
  const result = find('capacitors')
  assert.ok(result.parts.length > 0)
  assert.ok(result.parts.every((entry) => entry.refdes.startsWith('C')))
})

console.log('\nrefusals')
check('a family word alone explains itself instead of pretending', () => {
  const result = find('capacitors')
  assert.ok(result.notes.some((note) => /only says which family/.test(note)))
})
check('an unknown description matches nothing and says so', () => {
  const result = find('the HDMI transmitter')
  assert.equal(result.parts.length, 0)
  assert.ok(result.notes.some((note) => /nothing on this board matches/.test(note)))
})
check('a supply word on an anonymous board names the fix', () => {
  // A vendor export that renames every net NetNNN cannot answer "3v3" from the
  // file, so the resolver must say that rather than list random rails.
  const anonymous = {
    units: 'mm',
    parts: [part('N7', 4, null, 0)],
    pins: [
      { x: 0, y: 0, part: 0, index: 1, net: 'Net1', layer: 'top' },
      { x: 1, y: 0, part: 0, index: 2, net: 'Net2', layer: 'top' },
    ],
    nets: [
      { name: 'Net1', pins: [0], ground: false, power: false },
      { name: 'Net2', pins: [1], ground: false, power: false },
    ],
    stats: { parts: 1, pins: 2, nets: 2 },
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
  }
  const result = resolveQuery(anonymous, { query: '3v3 supply', limit: 4 })
  assert.equal(result.nets.length, 0)
  assert.ok(result.notes.some((note) => /label_rail|NetNNN/.test(note)))
})

console.log('\nnets')
check('a ground description resolves to the ground net', () => {
  const result = find('ground')
  assert.equal(result.nets[0].name, 'GND')
  assert.equal(result.nets[0].kind, 'ground')
})
check('a named rail resolves by name', () => {
  const result = find('VDDCR_SOC')
  assert.equal(result.nets[0].name, 'VDDCR_SOC')
})
check('a supply hint prefers the supplied rails once something matched', () => {
  const result = find('VDDCR_SOC rail')
  assert.equal(result.nets[0].kind, 'power')
})

console.log('\nrobustness')
check('an empty query is not a crash', () => {
  const result = resolveQuery(board, { query: '', limit: 3 })
  assert.equal(result.parts.length, 0)
  assert.ok(result.notes.length > 0)
})
check('duplicate designators are collapsed', () => {
  const doubled = fixtureBoard()
  doubled.parts.push({ ...doubled.parts[1] })
  const result = resolveQuery(doubled, { query: 'capacitors', limit: 10 })
  const refs = result.parts.map((entry) => entry.refdes)
  assert.equal(new Set(refs).size, refs.length)
})
check('the limit is respected', () => {
  const result = find('capacitors', { limit: 2 })
  assert.ok(result.parts.length <= 2)
})
check('every candidate carries a reason', () => {
  for (const query of ['N1', '290 pad chip', 'the coil near N1', 'ground', 'capacitors']) {
    const result = find(query)
    for (const entry of [...result.parts, ...result.nets]) {
      assert.ok(entry.reasons.length > 0, `${query} produced an unexplained candidate`)
    }
  }
})

console.log(failures.length === 0 ? `\nRESOLVE CHECKS PASS (${passed})` : `\n${failures.length} RESOLVE CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
