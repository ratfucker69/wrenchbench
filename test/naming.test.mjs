/**
 * Naming tests.
 *
 * Two behaviours matter and both are refusals as much as features:
 *   - a part the boardview could not label is never renamed in place; the name
 *     lives beside the raw label as an alias;
 *   - an alias is only assigned when the schematic evidence is unique, and a
 *     generic marking (`0.1u`, which hundreds of capacitors share) never
 *     produces a name at all.
 *
 * Run with `node test/naming.test.mjs`.
 */
import assert from 'node:assert/strict'
import { classifyParts, classifyValue, isPlaceholderRefdes, planNaming } from '../naming.js'

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

const part = (refdes, pins, value = null) => ({
  refdes,
  pins,
  value,
  layer: 'top',
  smd: true,
  bbox: { x1: 0, y1: 0, x2: 1, y2: 1 },
})

/** A board with one unnamed SoC, one unnamed generic cap, and one real designator. */
function fixtureBoard() {
  return {
    units: 'mm',
    parts: [
      part('N1000', 290, 'CXD90061GG'),
      part('N1001', 2, '0.1u'),
      part('C0101', 2, '0.1u'),
      part('N1002', 1, null),
    ],
    pins: [],
    nets: [],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    stats: { parts: 4, pins: 0, nets: 0, layers: 1, probes: 0 },
  }
}

/** Schematic text: the SoC marking sits next to exactly one designator. */
const schematic = {
  pages: [
    {
      page: 6,
      text: 'Main SoC CXD90061GG IC5006 BGA 19x19\nCXD90061GG IC5006\nC0101 0.1u 6.3V 0603\nC0102 0.1u 6.3V 0603\nC0103 0.1u 6.3V 0603',
    },
  ],
}

console.log('\nvalue classification')
check('a device part number is treated as identifying', () => {
  assert.equal(classifyValue('CXD90061GG').strength, 'device')
  assert.equal(classifyValue('MN864739').family, 'device')
})
check('a capacitor value is generic, not identifying', () => {
  assert.equal(classifyValue('0.1u').strength, 'generic')
  assert.equal(classifyValue('0.1u').family, 'capacitor')
})
check('a resistor value is generic', () => {
  assert.equal(classifyValue('10k').family, 'resistor')
  assert.equal(classifyValue('390').family, 'resistor')
})
check('a bare package code proves nothing', () => {
  assert.equal(classifyValue('0603').strength, 'none')
})
check('an empty marking proves nothing', () => {
  assert.equal(classifyValue(null).strength, 'none')
})

console.log('\nplaceholder detection')
check('the boardview generated labels are recognised', () => {
  assert.equal(isPlaceholderRefdes('N16136'), true)
  assert.equal(isPlaceholderRefdes('C0101'), false)
  assert.equal(isPlaceholderRefdes('NC'), false)
})

console.log('\ncomponent versus pad')
check('a single-pad generated entry is a pad, not a component', () => {
  const board = fixtureBoard()
  const roles = classifyParts(board.parts)
  assert.equal(board.parts[3].role, 'pad')
  assert.equal(roles.pads, 1)
  assert.equal(roles.components, 3)
})
check('a multi-pad unnamed part stays a component', () => {
  const board = fixtureBoard()
  classifyParts(board.parts)
  assert.equal(board.parts[0].role, 'component')
})
check('a labelled single-pad part stays a component', () => {
  const board = fixtureBoard()
  classifyParts(board.parts)
  assert.equal(board.parts[2].role, 'component')
})

console.log('\nplanning names')
check('a unique device marking names the part', () => {
  const board = fixtureBoard()
  const plan = planNaming(board, schematic)
  const entry = plan.assignments.get(0)
  assert.ok(entry, 'the SoC should get an assignment')
  assert.equal(entry.alias, 'IC5006')
  assert.equal(entry.confidence, 'high')
  assert.equal(plan.namedFromSchematic, 1)
})
check('the module never rewrites the boardview label', () => {
  const board = fixtureBoard()
  planNaming(board, schematic)
  assert.equal(board.parts[0].refdes, 'N1000')
})
check('a generic marking yields candidates, never an alias', () => {
  const board = fixtureBoard()
  const plan = planNaming(board, schematic)
  const entry = plan.assignments.get(1)
  assert.equal(entry.alias, null)
  assert.equal(entry.confidence, 'ambiguous')
  assert.ok(entry.candidates.length > 0)
})
check('a part with no marking and no schematic is left unnamed', () => {
  const board = fixtureBoard()
  const plan = planNaming(board, null)
  assert.equal(plan.namedFromSchematic, 0)
  assert.equal(plan.assignments.size, 0)
  assert.equal(plan.unnamedCount, 3)
})
check('an unlabelled part is not reported as an ambiguity when there is no schematic', () => {
  const board = fixtureBoard()
  const plan = planNaming(board, null)
  assert.equal(plan.needsHuman, 3)
})

console.log(failures.length === 0 ? `\nNAMING CHECKS PASS (${passed})` : `\n${failures.length} NAMING CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
