/**
 * Rail naming from a schematic, tested on the arithmetic rather than on trust.
 *
 * The claim being tested is narrow and checkable: a schematic prints a supply
 * once per pin, the boardview counts pads per net on one part, and when a count
 * is unique on both sides the two must be the same rail. Everything ambiguous
 * has to stay ambiguous, and everything small has to stay a suggestion — those
 * are the cases where a wrong label would send a technician to the wrong rail.
 *
 * Run with `node test/schematic-rails.test.mjs`.
 */
import assert from 'node:assert/strict'

const { ballLabelledRails, matchSchematicRails, voltageTokens, voltageForSupply, AUTO_ASSIGN_PINS } =
  await import('../schematic-rails.js')
const { ensureLabelledRails, formatVoltage } = await import('../rails.js')

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
 * Build a board from a description: each part is a list of `[net, pads]`.
 * Pads are laid out one after another; nothing else about them matters.
 */
function board(parts) {
  const model = { parts: [], pins: [], nets: [] }
  const netPads = new Map()
  parts.forEach((nets, partIndex) => {
    model.parts.push({ refdes: `N${1000 + partIndex}`, layer: 'top', smd: true, pins: 0 })
    for (const [net, count] of nets) {
      for (let index = 0; index < count; index += 1) {
        model.pins.push({ x: index, y: 0, part: partIndex, index: index + 1, net, probe: null, layer: 'top' })
      }
      netPads.set(net, (netPads.get(net) ?? 0) + count)
    }
  })
  for (const [name, pads] of netPads) model.nets.push({ name, pins: Array.from({ length: pads }, (_, index) => index) })
  return model
}

/** A schematic page that prints each supply once per pin, as the real one does. */
function schematic(supplies) {
  const tokens = []
  for (const [name, pins] of Object.entries(supplies)) {
    for (const pin of pins) tokens.push(`${name}_${pin}`)
  }
  return {
    name: 'test schematic.pdf',
    pages: [{ page: 7, text: tokens.join('\n') }],
    stats: { pages: 1 },
  }
}

/**
 * n distinct BGA positions, so a supply can be given an exact pin count.
 *
 * Positions are lettered rows of forty columns, then two-letter rows, which is
 * how a large package is actually drawn: the column stays within two digits so
 * every label is parseable the way the real schematics are.
 */
function balls(n) {
  const rows = 'ABCDEFGHJKLMNPRTUVWY'
  const out = []
  for (let index = 0; index < n; index += 1) {
    const rowIndex = Math.floor(index / 40)
    const column = (index % 40) + 1
    const row =
      rowIndex < rows.length
        ? rows[rowIndex]
        : `${rows[rowIndex % rows.length]}${rows[Math.floor(rowIndex / rows.length) % rows.length]}`
    out.push(`${row}${column}`)
  }
  return out
}

console.log('\nreading supplies out of schematic text')

check('supplies are counted by distinct pins', () => {
  const model = schematic({ VDDCR_GFX: balls(30), VMEMP: balls(12) })
  const { rails } = ballLabelledRails(model)
  assert.equal(rails.length, 2)
  const gfx = rails.find((rail) => rail.name === 'VDDCR_GFX')
  assert.equal(gfx.pins, 30)
  assert.equal(gfx.balls.length, 30)
})

check('duplicate pins are counted once', () => {
  const model = {
    pages: [{ page: 1, text: 'VDDCR_GFX_A1\nVDDCR_GFX_A1\nVDDCR_GFX_A2\nVDDCR_GFX_A3\nVDDCR_GFX_A4' }],
  }
  const { rails } = ballLabelledRails(model)
  assert.equal(rails[0].pins, 4)
})

check('ground families and no-connects are not supplies', () => {
  const model = schematic({ VSS: balls(20), VSSQ: balls(9), GND: balls(8), VDDCR_GFX: balls(21) })
  const { rails } = ballLabelledRails(model)
  assert.deepEqual(rails.map((rail) => rail.name), ['VDDCR_GFX'])
})

check('a signal net that happens to end in a position is not a supply', () => {
  const model = schematic({ S40_G6_D1: balls(26), D85_SOC_DP0: balls(9), VDDCR_CORE: balls(22) })
  const { rails } = ballLabelledRails(model)
  assert.deepEqual(rails.map((rail) => rail.name), ['VDDCR_CORE'])
})

check('domain suffixes are not read as BGA positions', () => {
  const model = { pages: [{ page: 1, text: 'SOC_V33_S5 SOC_V18_S5 SOC_V33_S3 SOC_V18_S5' }] }
  const { rails, warnings } = ballLabelledRails(model)
  assert.equal(rails.length, 0)
  assert.match(warnings.join(' '), /no supply nets with pin positions/)
})

check('a schematic with no text says so instead of guessing', () => {
  const { rails, warnings } = ballLabelledRails({ pages: [] })
  assert.equal(rails.length, 0)
  assert.match(warnings.join(' '), /no pages of text/)
})

console.log('\nmatching supplies onto nets')

check('a unique large count names the rail, with both counts as evidence', () => {
  const model = board([
    [['GND', 30], ['Net73', 24], ['Net74', 12], ['Net9', 3]],
  ])
  const result = matchSchematicRails(model, schematic({ VDDCR_GFX: balls(24), VMEMP: balls(70) }))
  assert.equal(result.assignments.length, 1)
  const [assignment] = result.assignments
  assert.equal(assignment.net, 'Net73')
  assert.equal(assignment.rail, 'VDDCR_GFX')
  assert.equal(assignment.pins, 24)
  assert.equal(assignment.part, 'N1000')
  assert.match(assignment.evidence.join(' '), /24 pins on VDDCR_GFX/)
  assert.match(assignment.evidence.join(' '), /24 pads on Net73/)
})

check('a count shared by two nets is a choice, never a name', () => {
  const model = board([[['GND', 5], ['Net1', 26], ['Net2', 26]]])
  const result = matchSchematicRails(
    model,
    schematic({ VDDQ: balls(26), VDDQMIO: balls(26), VDDCR_CORE: balls(104) }),
  )
  assert.equal(result.assignments.length, 0)
  const choice = result.ambiguous.find((entry) => entry.confidence === 'choice')
  assert.ok(choice, 'the collision was not reported')
  assert.deepEqual(choice.nets.sort(), ['Net1', 'Net2'])
  assert.deepEqual(choice.supplies.sort(), ['VDDQ', 'VDDQMIO'])
})

check('a unique but small count is offered, not applied', () => {
  const model = board([[['GND', 9], ['Net13', 5]]])
  const result = matchSchematicRails(model, schematic({ VCCK: balls(5) }), { autoPins: AUTO_ASSIGN_PINS })
  assert.equal(result.assignments.length, 0)
  const offered = result.ambiguous.find((entry) => entry.nets.includes('Net13'))
  // Five pins is below the suggestion floor as well, so it is not even offered.
  assert.equal(offered, undefined)
})

check('eight to nineteen pins is a suggestion the technician can accept', () => {
  const model = board([[['GND', 9], ['Net226', 12]]])
  const result = matchSchematicRails(model, schematic({ VCCQ: balls(12) }))
  assert.equal(result.assignments.length, 0)
  const offered = result.ambiguous.find((entry) => entry.nets.includes('Net226'))
  assert.ok(offered, 'a 12-pin equality should at least be offered')
  assert.equal(offered.confidence, 'low')
  assert.match(offered.reason, /below the 20-pin threshold/)
})

check('ground and no-connect nets are never named', () => {
  const model = board([[['GND', 40], ['NC', 40], ['Net72', 80]]])
  const result = matchSchematicRails(model, schematic({ VDDCR_SOC: balls(80), VSS: balls(40) }))
  assert.deepEqual(result.assignments.map((entry) => entry.net), ['Net72'])
})

check('one supply is not assigned to two different parts', () => {
  const model = board([
    [['Net1', 30], ['GND', 4]],
    [['Net2', 30], ['GND', 4]],
  ])
  const result = matchSchematicRails(model, schematic({ VDDCR_GFX: balls(30) }))
  assert.equal(result.assignments.length, 1)
  assert.equal(result.assignments[0].net, 'Net1')
})

check('a bigger part wins the supply, and a smaller one gains nothing from it', () => {
  const model = board([
    [['Net5', 30], ['GND', 2]],
    [['Net6', 30], ['GND', 500]],
  ])
  const result = matchSchematicRails(model, schematic({
    VDDCR_CORE: balls(30),
    VDDCR_GFX: balls(2),
  }))
  assert.equal(result.assignments.length, 1)
  assert.equal(result.assignments[0].part, 'N1001')
  assert.equal(result.assignments[0].net, 'Net6')
})

check('counts are compared per part, not across the board', () => {
  // Net73 has 6 pads on the small part but 30 on the big one; the supply is
  // 30 pins, so only the big part can own it.
  const model = board([
    [['Net73', 6], ['GND', 2]],
    [['Net73', 30], ['GND', 8]],
  ])
  const result = matchSchematicRails(model, schematic({ VDDCR_GFX: balls(30) }))
  assert.equal(result.assignments.length, 1)
  assert.equal(result.assignments[0].part, 'N1001')
})

check('nothing is claimed when no pin count lines up', () => {
  const model = board([[['GND', 3], ['Net1', 7], ['Net2', 9]]])
  const result = matchSchematicRails(model, schematic({ VDDCR_CORE: balls(140) }))
  assert.equal(result.assignments.length, 0)
  assert.equal(result.ambiguous.length, 0)
  assert.equal(result.unmatched.length, 1)
})

check('the threshold is honoured as an option', () => {
  // The part needs enough pads to be worth fingerprinting at all.
  const model = board([[['GND', 3], ['Net9', 6], ['GND', 10]]])
  const strict = matchSchematicRails(model, schematic({ VDDQ: balls(6) }))
  assert.equal(strict.assignments.length, 0)
  const loose = matchSchematicRails(model, schematic({ VDDQ: balls(6) }), { autoPins: 6 })
  assert.equal(loose.assignments.length, 1)
  assert.equal(loose.assignments[0].net, 'Net9')
})

check('the real-shaped case resolves the way the bench verified it', () => {
  // Mirrors the EDM-010: the SoC's supplies count out to 80, 240 and 104 pins,
  // the boardview shows exactly those pad counts on Net72, Net73 and Net108.
  const model = board([
    [['GND', 900], ['Net73', 240], ['Net108', 104], ['Net72', 80], ['Net74', 47], ['Net13', 5], ['NC', 67]],
  ])
  const result = matchSchematicRails(
    model,
    schematic({
      VDDCR_GFX: balls(240),
      VDDCR_CORE: balls(104),
      VMEMIO: balls(80),
      VMEMP: balls(47),
      VCCK: balls(5),
    }),
  )
  const byNet = new Map(result.assignments.map((entry) => [entry.net, entry.rail]))
  assert.equal(byNet.get('Net73'), 'VDDCR_GFX')
  assert.equal(byNet.get('Net108'), 'VDDCR_CORE')
  assert.equal(byNet.get('Net72'), 'VMEMIO')
  assert.equal(byNet.get('Net74'), 'VMEMP')
  // 5 pins is under the floor, so VCCK is not written down.
  assert.equal(byNet.has('Net13'), false)
  for (const entry of result.assignments) {
    assert.ok(['high', 'medium'].includes(entry.confidence))
    assert.ok(entry.pins >= AUTO_ASSIGN_PINS)
  }
})

console.log('\nvoltages, as the bench names them')

check('a stated voltage is read off the supply stem', () => {
  const index = voltageTokens({
    pages: [{ page: 7, text: '1.0V_SOC_VGFX 1.35V_G6_VMEMIO 0.85V_SOC_VMEMP 3.3V_VRM 12V_MAIN' }],
  })
  assert.equal(voltageForSupply(index, 'VDDCR_GFX')?.volts, 1)
  assert.equal(voltageForSupply(index, 'VMEMIO')?.volts, 1.35)
  assert.equal(voltageForSupply(index, 'VMEMP')?.volts, 0.85)
})

check('two different voltages for one stem is "not stated", not a pick', () => {
  const index = voltageTokens({ pages: [{ page: 3, text: '1.0V_SOC_VSOC 1.8V_SOC' }] })
  assert.equal(voltageForSupply(index, 'VDDCR_SOC'), null)
})

check('the domain word in a net name does not claim a rail', () => {
  // 1.8V_SOC_V18_S5 ends in the domain code S5, not in a supply stem, so it
  // must not be read as VDDCR_SOC's voltage.
  const index = voltageTokens({ pages: [{ page: 3, text: '1.8V_SOC_V18_S5 0.75V_SOC_VCR_S5' }] })
  assert.equal(voltageForSupply(index, 'VDDCR_SOC'), null)
})

check('a supply with no stated voltage stays unknown', () => {
  const index = voltageTokens({ pages: [{ page: 1, text: 'VDDCR_GFX_A12 VDDCR_GFX_A14' }] })
  assert.equal(voltageForSupply(index, 'VDDCR_GFX'), null)
})

check('matching attaches the voltage and its evidence', () => {
  const model = board([[['GND', 30], ['Net73', 40], ['Net108', 60]]])
  const result = matchSchematicRails(
    model,
    {
      pages: [
        { page: 7, text: `${balls(40).map((ball) => `VDDCR_GFX_${ball}`).join(' ')}` },
        { page: 26, text: '1.0V_SOC_VGFX' },
      ],
    },
  )
  const gfx = result.assignments.find((entry) => entry.rail === 'VDDCR_GFX')
  assert.ok(gfx, 'VDDCR_GFX was not matched')
  assert.equal(gfx.voltage, 1)
  assert.match(gfx.evidence.join(' '), /1.0V_SOC_VGFX/)
})

check('a rail with no stated voltage reports null rather than a guess', () => {
  const model = board([[['GND', 30], ['Net73', 40]]])
  const result = matchSchematicRails(
    model,
    { pages: [{ page: 7, text: balls(40).map((ball) => `VDDCR_GFX_${ball}`).join(' ') }] },
  )
  assert.equal(result.assignments[0].voltage, null)
})

console.log('\nthe simple name a technician uses')

check('volts print the way the bench says them', () => {
  assert.equal(formatVoltage(1), '1.0 V')
  assert.equal(formatVoltage(1.35), '1.35 V')
  assert.equal(formatVoltage(3.3), '3.3 V')
  assert.equal(formatVoltage(12), '12 V')
  assert.equal(formatVoltage(5), '5 V')
  assert.equal(formatVoltage(null), null)
})

check('a named rail that reaches few pads is still listed', () => {
  const model = board([[['GND', 400], ['Net72', 300], ['Net75', 12]]])
  const { rails } = { rails: [{ name: 'Net72', pads: 300, voltage: null, label: 'Net72', alias: null, colour: '#000', reach: 10 }] }
  ensureLabelledRails(model, rails, {
    Net75: { label: 'VDDCR_SOC', voltage: 1, source: 'schematic', confidence: 'medium' },
  })
  const added = rails.find((rail) => rail.name === 'Net75')
  assert.ok(added, 'the named rail was dropped from the list')
  assert.equal(added.label, 'VDDCR_SOC')
  assert.equal(added.voltage, 1)
  assert.equal(added.pads, 12)
})

check('an unnamed rail is not added and a labelled one is not duplicated', () => {
  const model = board([[['GND', 400], ['Net72', 300]]])
  const rails = [{ name: 'Net72', pads: 300, voltage: null, label: 'Net72', alias: null, colour: '#000', reach: 10 }]
  ensureLabelledRails(model, rails, { Net72: { label: 'VMEMIO', voltage: 1.35 }, GND: { label: 'GND' }, Net999: { label: 'X' } })
  assert.equal(rails.length, 1)
  assert.equal(rails[0].voltage, null, 'the caller applies labels; this only adds missing rails')
})

console.log('')
if (failures.length > 0) {
  console.log(`${failures.length} SCHEMATIC-RAIL CHECK(S) FAILED`)
  for (const failure of failures) console.log(`  ${failure.name}: ${failure.error.stack?.split('\n')[1]?.trim() ?? ''}`)
  process.exit(1)
}
console.log(`SCHEMATIC-RAIL CHECKS PASS (${passed})`)
