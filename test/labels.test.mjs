/**
 * Bench-mark and rail-label tests, at the store level.
 *
 * These cover the two pieces of state a technician builds up over a session:
 * what they have marked as shorted, and what they have decided each anonymous
 * rail actually is. Both must survive a reload, and both must be idempotent —
 * re-marking the same pad, or re-labelling the same rail, must not accumulate
 * duplicates.
 *
 * Run with `node test/labels.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const libraryDir = path.join(os.tmpdir(), `wrenchbench-labels-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

const store = await import('../store.js')
const { assignComponentRails, classifyRails, voltageOf } = await import('../rails.js')

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

// A two-rail board: one big net, one small, plus ground.
function fixtureBoard() {
  const parts = [
    { refdes: 'C1', layer: 'top', smd: true, pins: 2, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } },
    { refdes: 'C2', layer: 'top', smd: true, pins: 2, bbox: { x1: 2, y1: 0, x2: 3, y2: 1 } },
    { refdes: 'R1', layer: 'top', smd: true, pins: 2, bbox: { x1: 4, y1: 0, x2: 5, y2: 1 } },
  ]
  const pins = []
  const push = (part, net) => pins.push({ part, net, x: part, y: 0, index: pins.length })
  for (let index = 0; index < 40; index += 1) push(0, 'Net72')
  for (let index = 0; index < 40; index += 1) push(1, 'Net73')
  for (let index = 0; index < 60; index += 1) push(2, 'GND')
  const nets = [
    { name: 'Net72', pins: pins.filter((pin) => pin.net === 'Net72'), ground: false },
    { name: 'Net73', pins: pins.filter((pin) => pin.net === 'Net73'), ground: false },
    { name: 'GND', pins: pins.filter((pin) => pin.net === 'GND'), ground: true },
  ]
  return {
    units: 'mm',
    parts,
    pins,
    nets,
    stats: { parts: parts.length, pins: pins.length, nets: nets.length, layers: 1, probes: 0 },
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 1 },
  }
}

const board = fixtureBoard()
const boardId = 'label-fixture'
store.saveBoard({ id: boardId, name: 'Label Fixture', format: 'brd', board, warnings: [] })

console.log('\nrail labels')

check('a board starts with no rail labels', () => {
  assert.deepEqual(store.readRailLabels(boardId), {})
})

check('a label is stored against the real net name', () => {
  store.setRailLabel(boardId, 'Net72', 'VDDCR_SOC')
  const labels = store.readRailLabels(boardId)
  assert.equal(labels.Net72.label, 'VDDCR_SOC')
})

check('labelling the same rail twice replaces rather than duplicates', () => {
  store.setRailLabel(boardId, 'Net72', 'PP1V8_S0')
  const labels = store.readRailLabels(boardId)
  assert.equal(labels.Net72.label, 'PP1V8_S0')
  assert.equal(Object.keys(labels).length, 1)
})

check('an empty label clears it', () => {
  store.setRailLabel(boardId, 'Net72', '')
  assert.deepEqual(store.readRailLabels(boardId), {})
})

check('an unknown board id is not written', () => {
  assert.throws(() => store.setRailLabel('nope/nope', 'Net72', 'x'), /unknown board/)
})

check('a label is picked up as the rail label and voltage', () => {
  store.setRailLabel(boardId, 'Net72', 'PP1V8_S0')
  const rails = classifyRails(board).rails
  const model = assignComponentRails(board)
  assert.equal(model.rails.length >= 2, true)
  // applyRailLabels lives on the host; emulate its contract here.
  for (const rail of rails) {
    const owned = store.readRailLabels(boardId)[rail.name]
    if (owned) {
      rail.label = owned.label
      const volts = voltageOf(owned.label)
      if (volts !== null) rail.voltage = volts
    }
  }
  const target = rails.find((rail) => rail.name === 'Net72')
  assert.equal(target.label, 'PP1V8_S0')
  assert.equal(target.voltage, 1.8)
})

console.log('\nbench marks')

check('a mark is recorded and read back', () => {
  store.addObservation(boardId, { kind: 'short-to-ground', refdes: 'C1' })
  const marks = store.readObservations(boardId)
  assert.equal(marks.length, 1)
  assert.equal(marks[0].kind, 'short-to-ground')
  assert.equal(marks[0].refdes, 'C1')
})

check('re-marking the same target is idempotent', () => {
  store.addObservation(boardId, { kind: 'short-to-ground', refdes: 'C1' })
  assert.equal(store.readObservations(boardId).length, 1)
})

check('an unknown kind is refused', () => {
  assert.throws(() => store.addObservation(boardId, { kind: 'exploded', refdes: 'C1' }))
})

check('a mark with neither refdes nor net is refused', () => {
  assert.throws(() => store.addObservation(boardId, { kind: 'short' }), /refdes or a net/)
})

check('clearing removes every mark', () => {
  store.clearObservations(boardId, {})
  assert.equal(store.readObservations(boardId).length, 0)
})

fs.rmSync(libraryDir, { recursive: true, force: true })

console.log(failures.length === 0 ? `\nLABEL CHECKS PASS (${passed})` : `\n${failures.length} LABEL CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
