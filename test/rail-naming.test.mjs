/**
 * Dynamic rail naming: the strategies, their honesty rules, and the library
 * that learns from every board.
 *
 * The engine exists because one board is not a bench. These tests pin down what
 * generalises (shape similarity, vocabulary extraction, learning) and what must
 * never generalise (a suggestion silently becoming a name).
 *
 * Run with `node test/rail-naming.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.join(os.tmpdir(), `wrenchbench-naming-${process.pid}`)
fs.mkdirSync(root, { recursive: true })

const { netSignature, signatureSimilarity, railVocabulary, planRailNames, PROVEN_PINS } = await import(
  '../rail-naming.js'
)
const { createRailLibrary } = await import('../rail-library.js')

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

/** Board from `[net, [{part, pads}]]`, with pads on the given net per part. */
function board(partsByName) {
  const model = { parts: [], pins: [], nets: [] }
  let partIndex = 0
  const netPads = new Map()
  for (const [refdes, nets] of Object.entries(partsByName)) {
    model.parts.push({ refdes, layer: 'top', smd: true })
    for (const [net, count] of Object.entries(nets)) {
      for (let index = 0; index < count; index += 1) {
        model.pins.push({ x: index, y: 0, part: partIndex, index: index + 1, net, layer: 'top' })
      }
      netPads.set(net, (netPads.get(net) ?? 0) + count)
    }
    partIndex += 1
  }
  for (const [name, pads] of netPads) model.nets.push({ name, pins: Array.from({ length: pads }, (_, i) => i) })
  return model
}

/** A capacitor between a rail and ground. */
const cap = (net) => ({ [net]: 1, GND: 1 })

console.log('\nshapes')

check('a net signature counts pads, parts, multi-pad devices and decoupling caps', () => {
  const model = board({
    N1: { SoC: 40, GND: 5 },
    C1: cap('SoC'),
    C2: cap('SoC'),
    C3: cap('SoC'),
    C4: { OTHER: 1, GND: 1 },
  })
  const signature = netSignature(model, 'SoC')
  assert.ok(signature)
  // 40 on the chip plus the three decoupling caps that reach the same net.
  assert.equal(Math.round(2 ** signature.pads - 1), 43)
  assert.equal(Math.round(2 ** signature.deco - 1), 3)
  assert.equal(Math.round(2 ** signature.multi - 1), 1)
})

check('similar rails score high, dissimilar rails do not', () => {
  const model = board({
    A: { R1: 200, GND: 4 },
    B: { R2: 190, GND: 4 },
    C: { R3: 3, GND: 1 },
  })
  const one = netSignature(model, 'R1')
  const two = netSignature(model, 'R2')
  const three = netSignature(model, 'R3')
  assert.ok(signatureSimilarity(one, two) > 0.95, `${signatureSimilarity(one, two)}`)
  assert.ok(signatureSimilarity(one, three) < 0.75, `${signatureSimilarity(one, three)}`)
})

console.log('\nvocabulary')

check('supply names and voltage-named rails are both read out', () => {
  const words = railVocabulary({
    pages: [
      { page: 4, text: 'Main SoC (Power)\nVDDCR_SOC\nVDD_CPU\nPP1V8_S0\n3.3V_VRM\n+5V\n' },
      { page: 9, text: 'VDDCR_SOC 1.05V C100 10u\nVDD_CPU\n' },
    ],
  })
  const names = words.map((word) => word.name)
  for (const expected of ['VDDCR_SOC', 'VDD_CPU', 'PP1V8_S0', '3.3V_VRM', '+5V']) {
    assert.ok(names.includes(expected), `${expected} missing from ${names.join(',')}`)
  }
  assert.ok(words.every((word) => !/^[A-Z]{1,3}\d+$/.test(word.name)), 'a designator leaked in')
})

check('a supply that is printed with its voltage carries that voltage', () => {
  const words = railVocabulary({ pages: [{ page: 2, text: '1.35V_G6_VMEMIO 0.85V_SOC_VMEMP' }] })
  const memio = words.find((word) => word.name === '1.35V_G6_VMEMIO')
  assert.ok(memio, 'voltage-named rail missing')
  assert.equal(memio.voltage, 1.35)
})

check('a per-pin label is not offered as a rail name', () => {
  const words = railVocabulary({ pages: [{ page: 7, text: 'VDDCR_GFX_A12 VDDCR_GFX_A14' }] })
  assert.ok(!words.some((word) => /_A\d+$/.test(word.name)), words.map((w) => w.name).join(','))
})

console.log('\nplanning')

check('a proved pin-position match is applied with its evidence', () => {
  const balls = Array.from({ length: 60 }, (_, index) => `A${index + 1}`)
  const model = board({
    SoC: { Net73: 60, GND: 10 },
    C1: cap('Net73'),
  })
  const plan = planRailNames({
    board: model,
    schematic: { pages: [{ page: 7, text: balls.map((ball) => `VDDCR_GFX_${ball}`).join(' ') }] },
    labels: {},
    library: [],
  })
  assert.equal(plan.applied.length, 1)
  assert.equal(plan.applied[0].rail, 'VDDCR_GFX')
  assert.ok(plan.applied[0].evidence.length >= 2)
  assert.ok(plan.applied[0].confidence === 'high')
})

check('a count under the proof threshold is never applied', () => {
  const balls = Array.from({ length: PROVEN_PINS - 1 }, (_, index) => `B${index + 1}`)
  const model = board({ SoC: { Net9: PROVEN_PINS - 1, GND: 4 } })
  const plan = planRailNames({
    board: model,
    schematic: { pages: [{ page: 7, text: balls.map((ball) => `VDDCORE_${ball}`).join(' ') }] },
    labels: {},
    library: [],
  })
  assert.equal(plan.applied.length, 0)
})

check('an unmatchable board still gets vocabulary suggestions from the schematic', () => {
  const model = board({
    SoC: { Net226: 90, GND: 20 },
    C1: cap('Net226'),
  })
  const plan = planRailNames({
    board: model,
    schematic: {
      pages: [
        { page: 3, text: 'VDDCR_SOC\nVDDQ\nVDDIO\nVCCQ\nVMEMIO\n' },
      ],
    },
    labels: {},
    library: [],
  })
  assert.equal(plan.applied.length, 0, 'nothing should be proved here')
  const suggestion = plan.suggestions.find((entry) => entry.net === 'Net226')
  assert.ok(suggestion, 'the biggest unnamed rail was not offered')
  assert.equal(suggestion.source, 'vocabulary')
  assert.ok((suggestion.choices ?? []).length >= 1)
})

check('a bench label is never replaced by the engine', () => {
  const balls = Array.from({ length: 40 }, (_, index) => `C${index + 1}`)
  const model = board({ SoC: { Net73: 40, GND: 4 } })
  const plan = planRailNames({
    board: model,
    schematic: { pages: [{ page: 7, text: balls.map((ball) => `VDDCR_GFX_${ball}`).join(' ') }] },
    labels: { Net73: { label: 'VDDCR_GFX', source: 'bench' } },
    library: [],
  })
  assert.equal(plan.applied.length, 0, 'an already-named net was re-applied')
})

console.log('\nlearning across boards')

check('a named rail is remembered, and a similar net on another board is suggested', () => {
  const library = createRailLibrary(root)
  const first = board({ SoC: { Net72: 120, GND: 30 }, C1: cap('Net72'), C2: cap('Net72') })
  const signature = netSignature(first, 'Net72')
  library.learn({ name: 'VMEMIO', voltage: 1.35, signature, boardId: 'board-a', boardName: 'A', net: 'Net72' })

  assert.equal(library.all().length, 1)
  assert.equal(library.knownNames()[0].name, 'VMEMIO')
  assert.equal(library.knownNames()[0].voltage, 1.35)

  // A different board, same shape of rail, different net name.
  const second = board({ SoC: { Net9: 118, GND: 30 }, C1: cap('Net9'), C2: cap('Net9') })
  const plan = planRailNames({ board: second, schematic: null, labels: {}, library: library.all() })
  const suggestion = plan.suggestions.find((entry) => entry.net === 'Net9')
  assert.ok(suggestion, 'the learned rail was not offered')
  assert.equal(suggestion.rail, 'VMEMIO')
  assert.equal(suggestion.source, 'prior-board')
  assert.match(suggestion.reason, /another board/)
})

check('an unlike rail is not suggested', () => {
  const library = createRailLibrary(root)
  const model = board({ SoC: { Net5: 4, GND: 1 } })
  const plan = planRailNames({ board: model, schematic: null, labels: {}, library: library.all() })
  assert.equal(plan.suggestions.length, 0, JSON.stringify(plan.suggestions))
})

check('the library forgets a deleted board and stays bounded', () => {
  const library = createRailLibrary(root)
  const model = board({ SoC: { Net1: 30, GND: 3 } })
  const signature = netSignature(model, 'Net1')
  for (let index = 0; index < 30; index += 1) {
    library.learn({ name: `RAIL_${index}`, signature, boardId: `board-${index}`, net: 'Net1' })
  }
  const before = library.all().length
  assert.ok(before >= 30, String(before))
  const forgotten = library.forgetBoard('board-0')
  assert.equal(forgotten, 1)
  assert.equal(library.all().some((entry) => entry.boardId === 'board-0'), false)
})

console.log('')
try {
  fs.rmSync(root, { recursive: true, force: true })
} catch {
  // best effort
}
if (failures.length > 0) {
  console.log(`${failures.length} RAIL-NAMING CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`RAIL-NAMING CHECKS PASS (${passed})`)
