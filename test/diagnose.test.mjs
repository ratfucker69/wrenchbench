/**
 * Short-circuit reasoning test. Run with `node test/diagnose.test.mjs`.
 *
 * The fixture is deliberately small enough to reason about by hand: a 1V8 rail
 * with two decoupling capacitors on it (one near, one far), an IC that also
 * bridges the rail to ground, and an unrelated net.
 */
import { nextChecks } from '../diagnose.js'

const failures = []
function expect(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`)
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

/**
 * C1: 1V8 / GND          near the marked part
 * C2: 1V8 / GND          far away
 * U1: 1V8 / 3V3 / GND    a many-pad package
 * R1: SIG / GND          not on the rail at all
 * C3: SIG / GND          not on the rail
 * All coordinates in millimetres.
 */
const parts = [
  { refdes: 'C1', pins: 2, layer: 'top', smd: true, bbox: { x1: 0, y1: 0, x2: 10, y2: 10 } },
  { refdes: 'C2', pins: 2, layer: 'top', smd: true, bbox: { x1: 400, y1: 0, x2: 410, y2: 10 } },
  { refdes: 'U1', pins: 40, layer: 'top', smd: true, bbox: { x1: 20, y1: 0, x2: 60, y2: 40 } },
  { refdes: 'R1', pins: 2, layer: 'top', smd: true, bbox: { x1: 80, y1: 0, x2: 90, y2: 10 } },
  { refdes: 'C3', pins: 2, layer: 'top', smd: true, bbox: { x1: 100, y1: 0, x2: 110, y2: 10 } },
  { refdes: 'C4', pins: 2, layer: 'top', smd: true, bbox: { x1: 12, y1: 0, x2: 18, y2: 10 } },
]

const wiring = [
  ['C1', '1V8'], ['C1', 'GND'],
  ['C2', '1V8'], ['C2', 'GND'],
  ['U1', '1V8'], ['U1', '3V3'], ['U1', 'GND'], ['U1', 'SIG'],
  ['R1', 'SIG'], ['R1', 'GND'],
  ['C3', 'SIG'], ['C3', 'GND'],
  ['C4', '1V8'], ['C4', 'GND'],
]

const pins = []
const counters = new Map()
const netPins = new Map()
for (const [refdes, net] of wiring) {
  const partIndex = parts.findIndex((part) => part.refdes === refdes)
  const index = (counters.get(refdes) ?? 0) + 1
  counters.set(refdes, index)
  const part = parts[partIndex]
  pins.push({
    x: (part.bbox.x1 + part.bbox.x2) / 2,
    y: (part.bbox.y1 + part.bbox.y2) / 2,
    part: partIndex,
    index,
    net,
    layer: 'top',
    probe: null,
  })
  const bucket = netPins.get(net) ?? []
  bucket.push(pins.length - 1)
  netPins.set(net, bucket)
}

const board = {
  units: 'mm',
  parts,
  pins,
  nets: [...netPins.entries()].map(([name, indices]) => ({
    name,
    pins: indices,
    power: name === '1V8' || name === '3V3',
    ground: name === 'GND',
  })),
  outline: [],
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 410, maxY: 40 },
  stats: { parts: parts.length, pins: pins.length, nets: netPins.size, probes: 0, layers: 1 },
}

const refdesList = (suspects) => suspects.map((suspect) => suspect.refdes)

console.log('short to ground on a rail')
const onRail = nextChecks(board, [{ kind: 'short-to-ground', net: '1V8' }])
const railNames = refdesList(onRail.suspects)
expect('components bridging the rail to ground are found', railNames.includes('C1') && railNames.includes('C2'), railNames.join(','))
expect('the IC that bridges the rail is found too', railNames.includes('U1'), railNames.join(','))
expect('parts off the rail are never suggested', !railNames.includes('R1') && !railNames.includes('C3'), railNames.join(','))
expect('two-terminal capacitors outrank the 40-pad package', railNames.indexOf('C1') < railNames.indexOf('U1'), railNames.join(','))
expect('every suspect carries evidence', onRail.suspects.every((suspect) => suspect.evidence.length > 0))
expect('evidence names the grounded net', onRail.suspects.some((suspect) => suspect.evidence.some((line) => /to GND/.test(line))))

console.log('\nproximity breaks a tie')
// C1 is ~11 mm from the marked C4, C2 is ~390 mm away, so C1 must rank higher.
const near = nextChecks(board, [{ kind: 'short-to-ground', refdes: 'C4' }])
const nearNames = refdesList(near.suspects)
expect('the marked part is not suggested back to the technician', !nearNames.includes('C4'), nearNames.join(','))
expect('the near capacitor outranks the distant one', nearNames.indexOf('C1') < nearNames.indexOf('C2'), nearNames.join(','))
expect('distance appears in the evidence', near.suspects.some((suspect) => suspect.evidence.some((line) => /mm from C4/.test(line))))

console.log('\nshort between nets')
const bridged = nextChecks(board, [{ kind: 'short', refdes: 'C1' }])
const bridgedNames = refdesList(bridged.suspects)
expect('parts sharing a suspect net are offered', bridgedNames.length > 0, bridgedNames.join(','))
expect('a part sharing two nets outranks one sharing a single net', bridgedNames.indexOf('U1') < bridgedNames.indexOf('C3') || !bridgedNames.includes('C3'), bridgedNames.join(','))

console.log('\ncleared and open marks')
const cleared = nextChecks(board, [
  { kind: 'short-to-ground', net: '1V8' },
  { kind: 'ok', refdes: 'C1' },
])
expect('a part measured good drops out', !refdesList(cleared.suspects).includes('C1'), refdesList(cleared.suspects).join(','))
expect('the rest of the list survives', refdesList(cleared.suspects).includes('C2'))

const opened = nextChecks(board, [{ kind: 'open', refdes: 'R1' }])
expect('an open lists neighbouring parts on its nets', refdesList(opened.suspects).length > 0, refdesList(opened.suspects).join(','))

console.log('\nedge cases')
const nothing = nextChecks(board, [])
expect('no marks yields no suspects', nothing.suspects.length === 0)
const unknown = nextChecks(board, [{ kind: 'short', refdes: 'ZZ99' }])
expect('an unknown refdes produces a note, not a crash', unknown.suspects.length === 0 && unknown.notes.length > 0, unknown.notes.join(';'))
const noGround = nextChecks({ ...board, nets: board.nets.filter((net) => !net.ground) }, [{ kind: 'short-to-ground', net: '1V8' }])
expect('a board without ground is reported honestly', noGround.suspects.length === 0 && noGround.notes.some((note) => /no ground net/.test(note)), noGround.notes.join(';'))

if (failures.length > 0) {
  console.log(`\n${failures.length} DIAGNOSE CHECK(S) FAILED`)
  process.exitCode = 1
} else {
  console.log('\nDIAGNOSE CHECKS PASS')
}
