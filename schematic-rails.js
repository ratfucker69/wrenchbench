/**
 * Rail naming from a schematic, by fingerprint.
 *
 * The PS5 EDM-010 export names every net `Net72`, and its refdes (`C00173`,
 * `N16136`) share no namespace with the schematic's designators (`C1027`,
 * `IC4001`). So neither the net name nor the part name can be joined across the
 * two files, and any attempt to match rails by name or by refdes is a guess.
 *
 * What *does* survive the renumbering is arithmetic: a schematic prints a
 * supply net once per pin it reaches, and those nets carry the pin's position —
 * `VDDCR_GFX_A12`, `VDDCR_GFX_A14`, … So counting the distinct pins under one
 * supply gives the number of pins that supply lands on *that device*. The
 * boardview then says how many pads of one part sit on a net. Those two numbers
 * are the same quantity expressed in each file's own language, and when a pin
 * count is unique among the schematic's supplies *and* unique among that part's
 * nets, the pairing is forced.
 *
 * On the EDM-010 that resolves the SoC's rails outright:
 *
 *   VDDCR_GFX 240 balls ↔ Net73 240 pads      VDDCR_CORE 104 ↔ Net108 104
 *   VMEMIO    80 balls  ↔ Net72  80 pads      VMEMP       47 ↔ Net74   47
 *   VDDCR_SOC 32 balls  ↔ Net75  32 pads
 *
 * Everything about this is inference, so it is reported as inference: each
 * assignment carries the part, the two counts and the pins it was built from.
 * Counts that several nets or several supplies share are left *ambiguous* and
 * surfaced for a human to choose, never assigned by picking one.
 */

/** A net label that embeds a BGA position: `VDDCR_GFX_A12`, `VMEMP_AA7`. */
const BALL_LABEL = /^([A-Z][A-Z0-9_]{3,})_([A-Z]{1,2}[0-9]{1,2})$/

/** Supply names, as opposed to signal names that also embed a position. */
const SUPPLY_NAME = /^V[A-Z0-9_]{2,}$/
/** Ground families: known, and not what this is for. */
const GROUND_FAMILY = /^(VSS|GND|VEEGND|AGND|DGND|PGND|VSSQ|VSSA|VSSD|AVSS|DVSS)/
/** Domain suffixes that are not BGA positions (`SOC_V33_S5` style). */
const DOMAIN_SUFFIX = /^(S[0-9]|P[0-9])$/

/** Below this many pins an equality is a coincidence more often than a rail. */
export const MIN_RAIL_PINS = 4
/**
 * Pins needed before a unique match is written down as a rail name.
 *
 * Small counts are not evidence: on the EDM-010, nineteen different parts have
 * exactly one net with five pads and six have exactly one net with twelve, so a
 * single-digit or low-teens equality proves nothing. From twenty pins up the
 * coincidence space collapses — VCCK's five pins are reported as a suggestion,
 * VDDCR_SOC's thirty-two are assigned.
 */
export const AUTO_ASSIGN_PINS = 20
/** Smallest part worth fingerprinting, in pads. */
const MIN_PART_PADS = 16
/**
 * Smallest equality worth offering as a *suggestion*.
 *
 * Below this, every part on the board owns some net of the same size, so the
 * list is noise rather than a shortlist: on the EDM-010 the ground rule filters
 * out a dozen "VBUS/VDDA/VDDP at 4 pins" rows that mean nothing.
 */
const SUGGEST_PINS = 8
/** Smallest tie worth putting in front of a human as a choice. */
const TIE_PINS = 12

/**
 * Supplies the schematic spells out, with the pins each one reaches.
 *
 * @param {object} schematic the stored schematic text layer
 * @returns {{rails: object[], byPins: Map<number, object[]>, warnings: string[]}}
 */
export function ballLabelledRails(schematic) {
  const pages = schematic?.pages
  const rails = []
  const warnings = []
  if (!Array.isArray(pages) || pages.length === 0) {
    return { rails, byPins: new Map(), warnings: ['the schematic carried no pages of text'] }
  }

  const byName = new Map()
  for (const page of pages) {
    const text = String(page?.text ?? '')
    if (text.length === 0) continue
    for (const token of text.split(/[\s\n\r\t]+/)) {
      if (token.length < 6) continue
      const match = BALL_LABEL.exec(token)
      if (!match) continue
      const [, name, ball] = match
      if (!SUPPLY_NAME.test(name) || GROUND_FAMILY.test(name)) continue
      if (DOMAIN_SUFFIX.test(ball)) continue
      let entry = byName.get(name)
      if (!entry) {
        entry = { name, balls: new Set(), pages: new Set() }
        byName.set(name, entry)
      }
      entry.balls.add(ball)
      entry.pages.add(page.page)
    }
  }

  for (const entry of byName.values()) {
    if (entry.balls.size < MIN_RAIL_PINS) continue
    rails.push({
      name: entry.name,
      pins: entry.balls.size,
      balls: [...entry.balls].sort(),
      pages: [...entry.pages].sort((a, b) => a - b),
    })
  }
  rails.sort((a, b) => b.pins - a.pins || a.name.localeCompare(b.name))
  if (rails.length === 0) {
    warnings.push(
      'the schematic text has no supply nets with pin positions in them (VDDCR_GFX_A12 style), so no rail can be fingerprint-matched',
    )
  }

  const byPins = new Map()
  for (const rail of rails) {
    if (!byPins.has(rail.pins)) byPins.set(rail.pins, [])
    byPins.get(rail.pins).push(rail)
  }
  return { rails, byPins, warnings }
}

/** Pads of each part, split by net. */
function pinsByPart(board) {
  const perPart = new Map()
  const pins = board?.pins ?? []
  for (let index = 0; index < pins.length; index += 1) {
    const pin = pins[index]
    if (pin?.part == null || !pin.net) continue
    let nets = perPart.get(pin.part)
    if (!nets) {
      nets = new Map()
      perPart.set(pin.part, nets)
    }
    nets.set(pin.net, (nets.get(pin.net) ?? 0) + 1)
  }
  return perPart
}

/**
 * Match a schematic's supplies onto a boardview's nets.
 *
 * @param {object} board the stored board model
 * @param {object} schematic the stored schematic text layer
 * @param {object} [options]
 * @param {number} [options.minPins] smallest pin count worth reporting at all (default MIN_RAIL_PINS)
 * @param {number} [options.autoPins] smallest pin count that may be written down as a name (default AUTO_ASSIGN_PINS)
 * @param {number} [options.maxParts] parts to fingerprint, largest first (default 48)
 * @returns {{
 *   assignments: object[], ambiguous: object[], parts: object[], rails: object[],
 *   unmatched: object[], warnings: string[]
 * }}
 */
export function matchSchematicRails(board, schematic, options = {}) {
  const minPins = Number.isFinite(options.minPins) ? Math.max(2, options.minPins) : MIN_RAIL_PINS
  const autoPins = Number.isFinite(options.autoPins) ? Math.max(minPins, options.autoPins) : AUTO_ASSIGN_PINS
  const maxParts = Number.isFinite(options.maxParts) ? Math.max(1, options.maxParts) : 48
  const { rails, byPins, warnings } = ballLabelledRails(schematic)
  const result = { assignments: [], ambiguous: [], parts: [], rails, unmatched: [], warnings: [...warnings] }
  if (rails.length === 0) return result

  const perPart = pinsByPart(board)
  const ranked = []
  for (const [partIndex, nets] of perPart) {
    let pads = 0
    for (const count of nets.values()) pads += count
    if (pads < MIN_PART_PADS) continue
    ranked.push({ partIndex, pads, nets })
  }
  ranked.sort((a, b) => b.pads - a.pads || a.partIndex - b.partIndex)
  ranked.length = Math.min(ranked.length, maxParts)

  // Nets already spoken for by a stronger part, and supplies already matched or
  // already offered once. A supply whose pin count is small turns up on every
  // part that happens to own a net of that size, so it is offered only from the
  // most pad-heavy part rather than from each of them in turn.
  const netOwner = new Map()
  const railOwner = new Map()
  const offered = new Set()

  /** A net that can never be a rail, whatever its pin count. */
  const notARail = (net) => GROUND_FAMILY.test(net) || /^(NC|NU|DNC|N\.?C\.?)$/i.test(net)

  for (const candidate of ranked) {
    const countToNets = new Map()
    for (const [net, count] of candidate.nets) {
      if (notARail(net)) continue
      if (!countToNets.has(count)) countToNets.set(count, [])
      countToNets.get(count).push(net)
    }

    const unique = []
    const ties = []
    for (const [count, nets] of countToNets) {
      const supplies = byPins.get(count)
      if (!supplies) continue
      if (nets.length === 1 && supplies.length === 1) {
        const net = nets[0]
        const supply = supplies[0]
        if (netOwner.has(net) || railOwner.has(net)) continue
        if (railOwner.has(supply.name)) continue
        unique.push({ net, supply, count })
      } else if (count >= Math.max(minPins, TIE_PINS)) {
        const free = nets.filter((net) => !netOwner.has(net))
        if (free.length === 0) continue
        ties.push({ count, nets: free.sort(), supplies: supplies.map((item) => item.name).sort() })
      }
    }
    if (unique.length === 0 && ties.length === 0) continue

    const part = board?.parts?.[candidate.partIndex]
    const refdes = part?.refdes ?? `#${candidate.partIndex}`
    const score = unique.reduce((total, item) => total + item.count, 0)
    if (unique.length > 0) {
      result.parts.push({ refdes, partIndex: candidate.partIndex, pads: candidate.pads, matches: unique.length, score })
    }

    for (const item of unique) {
      if (item.count < autoPins) {
        // A real equality, but too small to assert: offer it, once, from the
        // first part that shows it.
        if (item.count < SUGGEST_PINS) continue
        if (offered.has(item.supply.name)) continue
        offered.add(item.supply.name)
        result.ambiguous.push({
          count: item.count,
          nets: [item.net],
          supplies: [item.supply.name],
          part: refdes,
          confidence: 'low',
          reason: `${item.count} pins is below the ${autoPins}-pin threshold, so an equal count could be chance`,
        })
        continue
      }
      netOwner.set(item.net, refdes)
      railOwner.set(item.supply.name, item.net)
      result.assignments.push({
        net: item.net,
        rail: item.supply.name,
        pins: item.count,
        part: refdes,
        partIndex: candidate.partIndex,
        confidence: item.count >= autoPins * 2 ? 'high' : 'medium',
        evidence: [
          `schematic lists ${item.count} pins on ${item.supply.name} (page ${item.supply.pages.join(', ') || '?'})`,
          `${refdes} has ${item.count} pads on ${item.net}`,
          `no other net of ${refdes} has ${item.count} pads and no other supply reaches ${item.count} pins`,
        ],
        samples: item.supply.balls.slice(0, 6),
      })
    }

    // A genuine tie — several nets on this part with the same count as several
    // supplies — is a choice for the technician, never ours to make.
    for (const tie of ties) {
      if (tie.supplies.every((name) => railOwner.has(name))) continue
      result.ambiguous.push({
        count: tie.count,
        nets: tie.nets,
        supplies: tie.supplies,
        part: refdes,
        confidence: 'choice',
      })
    }
  }

  const assigned = new Set(result.assignments.map((item) => item.rail))
  result.unmatched = rails.filter((rail) => !assigned.has(rail.name))
  // Ambiguities that offer a real choice, deduplicated by pin count.
  const seen = new Set()
  result.ambiguous = result.ambiguous.filter((entry) => {
    const key = `${entry.count}:${entry.nets.join(',')}:${entry.supplies.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return result
}
