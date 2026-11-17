/**
 * Rail classification test. Run with `node test/rails.test.mjs`.
 */
import { classifyRails, voltageOf, assignComponentRails } from '../rails.js'

const failures = []
function expect(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

console.log('voltage parsing')
for (const [name, expected] of [
  ['+3V3', 3.3],
  ['3V3', 3.3],
  ['1V8', 1.8],
  ['PP1V8_S0', 1.8],
  ['PP5V7_LCM', 5.7],
  ['VDD_18_S5', 1.8],
  ['VDD_33', 3.3],
  ['+5V', 5],
  ['+12V', 12],
  ['3.3V', 3.3],
  ['1.8V', 1.8],
  ['0V9', 0.9],
  ['2V5', 2.5],
  ['VBUS', null],
  ['VDDCR_SOC', null],
  ['Net72', null],
  ['Net1844', null],
  ['SNet15', null],
  ['GND', null],
  ['AGND', null],
  ['NC', null],
]) {
  const actual = voltageOf(name)
  expect(`${name} -> ${expected === null ? 'no voltage' : `${expected} V`}`, actual === expected, String(actual))
}

/** Build a tiny board: a 1.8 V rail, a 3.3 V rail, ground, and one signal. */
function tinyBoard() {
  const parts = [
    { refdes: 'C1', pins: 2, layer: 'top', smd: true, bbox: { x1: 0, y1: 0, x2: 10, y2: 10 } }, // 1V8 / GND
    { refdes: 'C2', pins: 2, layer: 'top', smd: true, bbox: { x1: 20, y1: 0, x2: 30, y2: 10 } }, // 3V3 / GND
    { refdes: 'U1', pins: 4, layer: 'top', smd: true, bbox: { x1: 40, y1: 0, x2: 60, y2: 20 } }, // 1V8 / 3V3 / GND / SIG
    { refdes: 'R1', pins: 2, layer: 'top', smd: true, bbox: { x1: 70, y1: 0, x2: 80, y2: 10 } }, // SIG / GND
  ]
  const wiring = [
    ['C1', '1V8'],
    ['C1', 'GND'],
    ['C2', '3V3'],
    ['C2', 'GND'],
    ['U1', '1V8'],
    ['U1', '3V3'],
    ['U1', 'GND'],
    ['U1', 'SIG'],
    ['R1', 'SIG'],
    ['R1', 'GND'],
  ]
  const pins = []
  const netNames = new Map()
  for (const [refdes, net] of wiring) {
    const partIndex = parts.findIndex((part) => part.refdes === refdes)
    const x = parts[partIndex].bbox.x1
    pins.push({ x, y: 0, part: partIndex, index: (netNames.get(refdes) ?? 0) + 1, net, layer: 'top', probe: null })
    netNames.set(refdes, (netNames.get(refdes) ?? 0) + 1)
    const bucket = netNames.get(`net:${net}`) ?? []
    bucket.push(pins.length - 1)
    netNames.set(`net:${net}`, bucket)
  }
  const nets = ['GND', '1V8', '3V3', 'SIG'].map((name) => {
    const indices = netNames.get(`net:${name}`) ?? []
    return {
      name,
      pins: indices,
      power: /^(1V8|3V3)$/.test(name),
      ground: name === 'GND',
    }
  })
  return {
    units: 'mm',
    parts,
    pins,
    nets,
    outline: [],
    edges: [],
    bounds: { minX: 0, minY: 0, maxX: 80, maxY: 20 },
    stats: { parts: parts.length, pins: pins.length, nets: nets.length, probes: 0, layers: 1 },
  }
}

console.log('\nrail grouping')
const board = tinyBoard()
const { rails, threshold } = classifyRails(board)
const names = rails.map((rail) => rail.name)
expect('both named rails are grouped', names.includes('1V8') && names.includes('3V3'), names.join(','))
expect('ground is never a rail group', !names.includes('GND'), names.join(','))
expect('a named voltage survives', rails.find((rail) => rail.name === '1V8')?.voltage === 1.8)
expect('colours are distinct', new Set(rails.map((rail) => rail.colour)).size === rails.length)
expect('voltage rails rank first', rails[0].voltage !== null, `first is ${rails[0].name}`)
expect('the threshold is reported', Number.isFinite(threshold) && threshold >= 8, String(threshold))

console.log('\ncomponent assignment')
const { assignment } = assignComponentRails(board)
expect('C1 lands on 1V8', assignment.get(0) === '1V8', String(assignment.get(0)))
expect('C2 lands on 3V3', assignment.get(1) === '3V3', String(assignment.get(1)))
expect('a decoupling cap is not assigned to ground', assignment.get(0) !== 'GND')
expect('U1 lands on a rail it touches', ['1V8', '3V3'].includes(assignment.get(2)), String(assignment.get(2)))
expect('R1 with no rail is unassigned', assignment.get(3) === null, String(assignment.get(3)))

console.log('\nnameless export (the PS5 shape)')
// A vendor dump where every net is `NetNN`: the rail grouping has to come from
// fan-out alone. 100 pads total, so the threshold is 8 and the two wide nets
// qualify while the narrow ones do not.
const namelessParts = []
const namelessPins = []
const addNamelessPart = (refdes, nets) => {
  const partIndex = namelessParts.length
  namelessParts.push({ refdes, pins: nets.length, layer: 'top', smd: true, bbox: { x1: partIndex, y1: 0, x2: partIndex + 1, y2: 1 } })
  nets.forEach((net, index) => {
    namelessPins.push({ x: partIndex, y: 0, part: partIndex, index: index + 1, net, layer: 'top', probe: null })
  })
}
for (let index = 0; index < 40; index += 1) addNamelessPart(`C${index + 1}`, ['Net72', 'GND'])
for (let index = 0; index < 20; index += 1) addNamelessPart(`R${index + 1}`, ['Net73', 'GND'])
for (let index = 0; index < 5; index += 1) addNamelessPart(`U${index + 1}`, ['Net72', 'Net73', 'Net9', 'GND'])

const nameless = {
  units: 'mm',
  parts: namelessParts,
  pins: namelessPins,
  nets: ['GND', 'Net72', 'Net73', 'Net9'].map((name) => ({
    name,
    pins: namelessPins.map((pin, index) => (pin.net === name ? index : -1)).filter((index) => index >= 0),
    power: false,
    ground: name === 'GND',
  })),
  outline: [],
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 70, maxY: 2 },
  stats: { parts: namelessParts.length, pins: namelessPins.length, nets: 4, probes: 0, layers: 1 },
}
const namelessRails = classifyRails(nameless, { limit: 12 })
const namelessNames = namelessRails.rails.map((rail) => rail.name)
expect('fan-out still yields rail groups without names', namelessNames.length > 0, namelessNames.join(','))
expect('the widest nameless nets win', namelessNames.includes('Net72') && namelessNames.includes('Net73'), namelessNames.join(','))
expect('ground is still excluded', !namelessNames.includes('GND'), namelessNames.join(','))
expect('no voltage is invented', namelessRails.rails.every((rail) => rail.voltage === null))

if (failures.length > 0) {
  console.log(`\n${failures.length} RAIL CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nRAIL CHECKS PASS')
}
