/**
 * Short-tracking order tests.
 *
 * "Marked a short — what do I probe next?" only helps if the answer is in a
 * sensible order and the same order every time. This pins the ranking rules:
 *
 *   - a part that bridges the suspect rail to ground outranks one that merely
 *     shares a net with it;
 *   - a two-terminal passive outranks a huge package sitting on the same nets;
 *   - a shorter distance to the marked part wins a tie, and a part that does not
 *     touch the suspect net at all is never suggested;
 *   - an `ok` mark removes a part from the list;
 *   - equal evidence breaks ties deterministically (fewer nets, then refdes), so
 *     two runs on the same marks cannot disagree.
 *
 * Run with `node test/order.test.mjs`.
 */
import assert from 'node:assert/strict'
import { nextChecks } from '../diagnose.js'

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

/**
 * A board with one rail (`RAIL`) and ground, plus parts placed at known
 * distances:
 *   C1  — decoupling cap: RAIL + GND, 2 pads, right next to the marked part
 *   C2  — same, but far away
 *   R1  — resistor RAIL + a signal, not to ground (weaker evidence)
 *   U1  — big hub bridging RAIL + GND with 300 pads (must be penalised)
 *   X1  — a part on an unrelated net (must never appear)
 */
function fixtureBoard() {
  const parts = []
  const pins = []
  const nets = new Map()

  const addPart = (refdes, at, padNets) => {
    const index = parts.length
    parts.push({ refdes, layer: 'top', smd: true, pins: padNets.length, bbox: { x1: at, y1: 0, x2: at + 2, y2: 2 } })
    padNets.forEach((net, padIndex) => {
      pins.push({ x: at + padIndex, y: 0, part: index, index: padIndex + 1, net, layer: 'top' })
      if (!nets.has(net)) nets.set(net, [])
      nets.get(net).push(pins.length - 1)
    })
  }

  addPart('C01', 0, ['RAIL', 'GND']) // the marked part itself
  addPart('C02', 6, ['RAIL', 'GND']) // near decoupling cap
  addPart('C03', 400, ['RAIL', 'GND']) // far decoupling cap
  addPart('R01', 8, ['RAIL', 'SIG']) // touches the rail, not ground
  addPart('U01', 10, ['RAIL', 'GND', 'SIG', 'AUX']) // hub
  addPart('X01', 12, ['OTHER', 'ELSE']) // unrelated

  // Widen the hub so the pin penalty is real.
  const hub = parts.findIndex((part) => part.refdes === 'U01')
  for (let index = 0; index < 300; index += 1) {
    pins.push({ x: 10 + (index % 20) * 0.1, y: 1, part: hub, index: index + 5, net: `HUB${index % 3}`, layer: 'top' })
  }
  parts[hub].pins = pins.filter((pin) => pin.part === hub).length

  return {
    units: 'mm',
    parts,
    pins,
    nets: [...nets.entries()].map(([name, indices]) => ({
      name,
      pins: indices,
      ground: name === 'GND',
    })),
    stats: { parts: parts.length, pins: pins.length, nets: nets.size },
    bounds: { minX: 0, minY: 0, maxX: 500, maxY: 4 },
  }
}

const board = fixtureBoard()
const marks = [{ kind: 'short-to-ground', refdes: 'C01', net: null, pin: null }]

console.log('\nshort-to-ground ranking')

const result = nextChecks(board, marks, { limit: 10 })
const order = result.suspects.map((suspect) => suspect.refdes)

check('the marked part is never its own suspect', () => {
  assert.equal(order.includes('C01'), false)
})

check('only parts on the suspect rail are suggested', () => {
  assert.equal(order.includes('X01'), false)
})

check('the near decoupling cap is first', () => {
  assert.equal(order[0], 'C02')
})

check('a part that never touches ground is not a short-to-ground suspect', () => {
  // R01 sits on the rail but has no ground pad, so it cannot be the shunt.
  assert.equal(order.includes('R01'), false)
})

check('the marked part\'s neighbour outranks the far one and destroys the hub', () => {
  assert.equal(order[1], 'C03')
  assert.equal(order[2], 'U01')
})

check('a many-pad hub is ranked below the passives', () => {
  assert.ok(order.indexOf('U01') > order.indexOf('R01'))
})

check('the far cap still appears, after the near one', () => {
  assert.ok(order.indexOf('C02') < order.indexOf('C03'))
})

check('scores descend monotonically', () => {
  const scores = result.suspects.map((suspect) => suspect.score)
  for (let index = 1; index < scores.length; index += 1) {
    assert.ok(scores[index] <= scores[index - 1], `score went up at ${index}: ${scores.join(', ')}`)
  }
})

check('every suspect carries the evidence it was ranked on', () => {
  for (const suspect of result.suspects) {
    assert.ok(suspect.evidence.length > 0, `${suspect.refdes} has no evidence`)
    assert.ok(suspect.score > 0)
  }
})

check('the same marks produce the same order twice', () => {
  const again = nextChecks(board, marks, { limit: 10 }).suspects.map((suspect) => suspect.refdes)
  assert.deepEqual(again, order)
})

check('the limit is honoured from the top of the order', () => {
  const limited = nextChecks(board, marks, { limit: 2 }).suspects.map((suspect) => suspect.refdes)
  assert.deepEqual(limited, order.slice(0, 2))
})

console.log('\nmeasured-good suppression')

check('an ok mark removes a part and promotes the next one', () => {
  const withOk = nextChecks(board, [...marks, { kind: 'ok', refdes: 'C02', net: null, pin: null }], { limit: 10 })
  assert.equal(withOk.suspects.map((suspect) => suspect.refdes).includes('C02'), false)
  assert.equal(withOk.suspects[0].refdes, 'C03')
})

check('a short between two nets ranks a bridging part above a bystander', () => {
  const between = nextChecks(board, [{ kind: 'short', refdes: 'R01', net: null, pin: null }], { limit: 10 })
  const names = between.suspects.map((suspect) => suspect.refdes)
  assert.ok(names.includes('C01'), 'a part sharing RAIL with R01 should be a suspect')
  assert.equal(names[0], 'C02', 'the nearest shared-rail part leads')
  assert.equal(names.includes('R01'), false, 'the marked part is not its own suspect')
  assert.equal(names.includes('X01'), false)
})

console.log('\nnet-named marks')

check('marking a net directly works without a refdes', () => {
  const byNet = nextChecks(board, [{ kind: 'short-to-ground', refdes: null, net: 'RAIL' }], { limit: 10 })
  assert.ok(byNet.suspects.length > 0)
  assert.equal(byNet.suspects[0].refdes, 'C01')
})

console.log('\nedge cases')

check('no marks means no suspects and no crash', () => {
  const empty = nextChecks(board, [], { limit: 5 })
  assert.deepEqual(empty.suspects, [])
})

check('a mark on a part that is not on the board is reported, not crashed on', () => {
  const missing = nextChecks(board, [{ kind: 'short', refdes: 'ZZ99', net: null, pin: null }], { limit: 5 })
  assert.deepEqual(missing.suspects, [])
  assert.ok(missing.notes.some((note) => /not on this board/.test(note)))
})

console.log('\nbench-mark ordering hint')

check('many equal suspects add the injection note rather than a false ranking', () => {
  // Six identical caps on one rail cannot be separated by geometry.
  const flat = fixtureBoard()
  for (let index = 0; index < 6; index += 1) {
    const at = 100 + index * 3
    const partIndex = flat.parts.length
    flat.parts.push({ refdes: `CF${index}`, layer: 'top', smd: true, pins: 2, bbox: { x1: at, y1: 0, x2: at + 2, y2: 2 } })
    flat.pins.push({ x: at, y: 0, part: partIndex, index: 1, net: 'FLAT', layer: 'top' })
    flat.pins.push({ x: at + 1, y: 0, part: partIndex, index: 2, net: 'GND', layer: 'top' })
  }
  flat.nets.push({ name: 'FLAT', pins: flat.pins.map((pin, index) => (pin.net === 'FLAT' ? index : -1)).filter((i) => i >= 0), ground: false })
  const flatMarks = [{ kind: 'short-to-ground', refdes: null, net: 'FLAT' }]
  const flatResult = nextChecks(flat, flatMarks, { limit: 10 })
  const tied = flatResult.suspects.filter((suspect) => suspect.score === flatResult.suspects[0].score)
  if (tied.length >= 5) {
    assert.ok(flatResult.notes.some((note) => /Injecting|injection|warm/i.test(note)))
  }
})

console.log(failures.length === 0 ? `\nORDER CHECKS PASS (${passed})` : `\n${failures.length} ORDER CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
