/**
 * Plain-language search: the words a technician uses, resolved to real parts.
 *
 * The board fixture is deliberately hostile — opaque refdes, opaque net names —
 * because that is what the vendor exports on the bench look like, and a search
 * that only matches labels is useless on them.
 *
 * Run with `node test/synonyms.test.mjs`.
 */
import assert from 'node:assert/strict'

const { resolveColloquial, colloquialVocabulary } = await import('../synonyms.js')

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

/* ------------------------------------------------------------------ fixture */

function makeBoard() {
  // Two big packages, a switch-node phase, a choke, caps, resistors, and one
  // very wide supply net — the smallest board that can answer every question.
  const parts = [
    { refdes: 'N1', pins: 900, layer: 'top', smd: true, bbox: { x1: 0, y1: 0, x2: 20, y2: 20 } },
    { refdes: 'N2', pins: 400, layer: 'top', smd: true, bbox: { x1: 24, y1: 0, x2: 40, y2: 16 } },
    { refdes: 'N3', pins: 35, layer: 'top', smd: true, bbox: { x1: 42, y1: 0, x2: 46, y2: 4 } },
    { refdes: 'N4', pins: 2, layer: 'top', smd: true, bbox: { x1: 48, y1: 0, x2: 50, y2: 2 } },
    { refdes: 'C10', pins: 2, layer: 'top', smd: true, bbox: { x1: 52, y1: 0, x2: 53, y2: 1 } },
    { refdes: 'C11', pins: 2, layer: 'top', smd: true, bbox: { x1: 54, y1: 0, x2: 55, y2: 1 } },
    { refdes: 'R20', pins: 2, layer: 'top', smd: true, bbox: { x1: 56, y1: 0, x2: 57, y2: 1 } },
  ]
  const pins = []
  const add = (part, net) => pins.push({ part, index: pins.length, net, x: 0, y: 0, layer: 'top' })
  add(0, 'GND')
  add(0, 'Net10') // 12 V-ish supply
  add(0, 'Net73') // second supply
  add(1, 'Net10')
  add(1, 'Net108')
  add(2, 'Net10') // phase: supply in
  add(2, 'Net539') // switch node out
  add(3, 'Net539')
  add(3, 'Net108')
  add(4, 'Net10')
  add(4, 'GND')
  add(5, 'Net108')
  add(5, 'GND')
  add(6, 'Net108')
  add(6, 'GND')
  // Widen the supplies so the rail heuristic sees them as rails, not signals.
  for (let index = 0; index < 60; index += 1) add(0, 'Net10')
  for (let index = 0; index < 60; index += 1) add(0, 'Net73')
  for (let index = 0; index < 60; index += 1) add(1, 'Net108')

  const nets = [
    { name: 'GND', pins: pins.map((pin, index) => (pin.net === 'GND' ? index : -1)).filter((i) => i >= 0), ground: true },
    { name: 'Net10', pins: pins.map((pin, index) => (pin.net === 'Net10' ? index : -1)).filter((i) => i >= 0), power: true },
    { name: 'Net73', pins: pins.map((pin, index) => (pin.net === 'Net73' ? index : -1)).filter((i) => i >= 0), power: true },
    { name: 'Net108', pins: pins.map((pin, index) => (pin.net === 'Net108' ? index : -1)).filter((i) => i >= 0), power: true },
    { name: 'Net539', pins: pins.map((pin, index) => (pin.net === 'Net539' ? index : -1)).filter((i) => i >= 0), power: false },
  ]
  return { parts, pins, nets, stats: { parts: parts.length, pins: pins.length, nets: nets.length } }
}

const board = makeBoard()
const rails = [
  { name: 'Net72', pads: 1276, label: 'VMEMIO', voltage: 1.35 },
  { name: 'Net73', pads: 340, label: 'VDDCR_GFX', voltage: 1 },
  { name: 'Net108', pads: 149, label: 'VDDCR_CORE', voltage: 1 },
  { name: 'Net10', pads: 80, label: null },
]
const marks = [
  { kind: 'short', refdes: 'N3', pin: 6, note: '10.5 R to 12 V' },
  { kind: 'ok', refdes: 'C10', note: '6.4 kR' },
]
const context = { board, rails, marks }

/* --------------------------------------------------------------------- tests */

console.log('\nroles')

check('"mosfet" finds parts that bridge a supply and a switch node', () => {
  const answer = resolveColloquial('mosfet', context)
  assert.equal(answer.understood, true)
  assert.ok(answer.roles.includes('power-stage'))
  assert.ok(answer.parts.some((hit) => hit.refdes === 'N3'), 'the phase part is missing')
  assert.match(answer.parts[0].reason, /switch node/)
})

check('"cpu", "apu", "soc" and "processor" all reach the largest package', () => {
  for (const word of ['cpu', 'apu', 'soc', 'processor']) {
    const answer = resolveColloquial(word, context)
    assert.equal(answer.parts[0]?.refdes, 'N1', `${word} did not find the processor`)
    assert.match(answer.parts[0].reason, /largest pad count/)
  }
})

check('"gpu" reaches the next largest package, not the same one', () => {
  const answer = resolveColloquial('gpu', context)
  assert.equal(answer.parts[0]?.refdes, 'N2')
})

check('"cap" and "caps" both resolve to the C family', () => {
  for (const word of ['cap', 'caps', 'capacitor', 'mlcc']) {
    const answer = resolveColloquial(word, context)
    assert.deepEqual(answer.parts.map((hit) => hit.refdes).sort(), ['C10', 'C11'], `${word} missed the caps`)
  }
})

check('"coil" finds the two-pad choke between a supply and the switch node', () => {
  const answer = resolveColloquial('coil', context)
  assert.equal(answer.parts[0]?.refdes, 'N4')
  assert.match(answer.parts[0].reason, /output choke/)
})

check('"rail" lists the supplies with their pads and voltage', () => {
  const answer = resolveColloquial('rail', context)
  assert.ok(answer.nets.some((hit) => hit.net === 'Net108'))
  assert.ok(answer.nets.some((hit) => /VDDCR_CORE/.test(hit.reason)))
})

check('"ground" finds the ground plane', () => {
  const answer = resolveColloquial('gnd', context)
  assert.equal(answer.nets[0]?.net, 'GND')
})

check('"shorted" returns what is already marked', () => {
  const answer = resolveColloquial('shorted', context)
  assert.equal(answer.parts[0]?.refdes, 'N3')
  assert.match(answer.parts[0].reason, /already marked short/)
})

check('a role this board cannot have is refused, not faked', () => {
  const answer = resolveColloquial('fuse', context)
  assert.deepEqual(answer.parts, [])
  assert.equal(answer.understood, true, 'the word is understood even when the board has none')
})

console.log('\nnarrowing')

check('"mosfet for Net10" keeps only the parts on that net', () => {
  const answer = resolveColloquial('mosfet for Net10', context)
  assert.deepEqual(answer.parts.map((hit) => hit.refdes), ['N3'])
  assert.ok(answer.notes.some((note) => /restricted to Net10/.test(note)))
})

check('an unknown target is reported rather than silently ignored', () => {
  const answer = resolveColloquial('mosfet for Net999', context)
  assert.ok(answer.notes.some((note) => /Net999/.test(note)))
})

check('"parts near N2" uses distance when the caller can measure it', () => {
  const answer = resolveColloquial('coil near N2', { ...context, distance: () => 3 })
  assert.ok(answer.parts.length > 0)
  assert.match(answer.parts[0].reason, /3\.0 mm away/)
})

console.log('\nranking and narrowing')

check('a word from a rail’s own name wins over the widest rail', () => {
  const answer = resolveColloquial('vcore', { ...context, rails: [
    { name: 'Net72', pads: 1276, label: 'VMEMIO', voltage: 1.35 },
    { name: 'Net108', pads: 149, label: 'VDDCR_CORE', voltage: 1 },
  ] })
  assert.equal(answer.nets[0]?.net, 'Net108', 'the named rail was not ranked first')
  assert.match(answer.nets[0].reason, /name matches the query/)
})

check('a target can reach a part the role’s top slice would have cut', () => {
  // 15 caps, only the smallest sits on Net10: the target must still find it.
  const manyCaps = { ...board, parts: [...board.parts] }
  for (let index = 0; index < 15; index += 1) {
    manyCaps.parts.push({ refdes: `C9${index}`, pins: 40 - index, bbox: { x1: index, y1: 0, x2: index + 1, y2: 1 } })
    manyCaps.pins.push({ part: manyCaps.parts.length - 1, index: manyCaps.pins.length, net: index === 14 ? 'Net10' : 'Net73' })
  }
  const answer = resolveColloquial('cap for Net10', { board: manyCaps, rails, marks: [] })
  assert.ok(answer.parts.some((hit) => hit.refdes === 'C914'), 'the cap on the named net was cut away before filtering')
})

check('a connector question is refused when the export has no connector family', () => {
  const answer = resolveColloquial('psu', { ...context, board: { ...board, parts: board.parts.filter((part) => !/^(J|CN|P)/i.test(part.refdes)) } })
  assert.deepEqual(answer.parts, [], 'a guess was offered where the board has no connectors')
  assert.ok(answer.notes.some((note) => /nothing that matches/.test(note)))
})

console.log('\nfallback')

check('a label that exists still matches directly', () => {
  const answer = resolveColloquial('C10', context)
  assert.equal(answer.parts[0]?.refdes, 'C10')
  assert.equal(answer.understood, false)
})

check('a word with no match says why, instead of returning nothing', () => {
  const answer = resolveColloquial('flux valve', context)
  assert.equal(answer.parts.length, 0)
  assert.ok(answer.notes.some((note) => /renames everything/.test(note)))
})

check('an empty query is not a search', () => {
  const answer = resolveColloquial('   ', context)
  assert.equal(answer.understood, false)
  assert.deepEqual(answer.parts, [])
})

check('the vocabulary is published for the help text', () => {
  const vocabulary = colloquialVocabulary()
  assert.ok(vocabulary.length >= 12)
  assert.ok(vocabulary.find((entry) => entry.id === 'power-stage').terms.includes('drmos'))
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} COLLOQUIAL CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`COLLOQUIAL CHECKS PASS (${passed})`)
