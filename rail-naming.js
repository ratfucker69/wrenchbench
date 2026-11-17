/**
 * Rail naming that generalises past one board.
 *
 * A single schematic-and-one-board trick does not survive a bench that sees
 * hundreds of boards: some schematics print per-pin net names, most do not, and
 * a boardview may call its rails `+3V3` or `Net72`. So naming is a set of
 * independent strategies, each answering "what is this net called" with its own
 * evidence and its own confidence, merged into one proposal list:
 *
 *   1. `pin-position` — a schematic that prints a supply once per pin
 *      (`VDDCR_GFX_A12`). Counting positions gives pins per device, and the
 *      boardview gives that device's pads on a net. Unique on both sides: proved.
 *   2. `schematic-name` — the supply's own voltage, read from a voltage-prefixed
 *      net (`1.35V_G6_VMEMIO`), attached by stem. Never estimated.
 *   3. `prior-board` — a rail the technician (or an earlier proof) named on
 *      another board, whose electrical shape matches this net closely enough.
 *      This is what makes the thing improve with use.
 *   4. `vocabulary` — the rail names the schematic actually prints, offered as
 *      choices when nothing can be proved. One click, no typing, and the choice
 *      is learned.
 *
 * Only a proved or unambiguous match is applied to the board automatically.
 * Everything else is a suggestion carrying the reason and the numbers behind it,
 * because a wrong rail name sends a technician to the wrong pad.
 */

import { ballLabelledRails, matchSchematicRails, voltageForSupply, voltageTokens } from './schematic-rails.js'

/** Pins needed before a pin-position match is written down (see schematic-rails). */
export const PROVEN_PINS = 20

/** Similarity a prior board must reach before its name may be applied. */
export const PRIOR_APPLY_SIMILARITY = 0.94
/** How far ahead of the runner-up the winner must be. */
export const PRIOR_APPLY_MARGIN = 0.1

const GROUND = /^(GND|GROUND|VSS|AGND|DGND|PGND|GND_?[A-Z0-9]*)$/i
const NO_CONNECT = /^(NC|N\.?C\.?|DNC|NO_?CONNECT)$/i

/** A supply name, as schematics spell one. */
const SUPPLY_TOKEN =
  /^(?:VDD|VCC|VEE|VPH|VBAT|VREG|VIO|VSYS|VBUS|PP|AVDD|DVDD|PVDD|VMEM|VDDCR|VCCK|VCCQ|VDDO|VDDQ|VTT|VPP)[A-Z0-9_]{0,20}$/
/** A rail written with its voltage: `3.3V_VRM`, `0.85V_SOC`. */
const VOLTAGE_NAMED = /^\d{1,2}(?:[.,]\d{1,2})?V_[A-Z][A-Z0-9_]*$/i
/** A bare rail: `+5V`, `-12V`, `3V3` — but not a BOM voltage rating like `1.05V`. */
const VOLTAGE_BARE = /^(?:[+-]\d{1,2}(?:[.,]\d{1,2})?V|\d{1,2}V\d)$/i
/**
 * Tokens that sit next to a rail but are not one: a good signal is not a supply.
 * Offering `VDDQ_PG` as a rail name would send a technician to a 0 V net.
 */
const CONTROL_SIGNAL = /_(?:PG|PWROK|PGOOD|EN|ENABLE|SENSE|RST|RESET|CLK|DATA|SDA|SCL|INT|FAULT|ALERT|HOT|OK|SS)$/i
/** Names too generic to help anyone choose: every board prints them. */
const GENERIC_RAIL = /^(?:VDD|VCC|VEE|VSS|AVDD|DVDD|PVDD|VIO|VREF|VTH|VPP|VGG|V\(.*\))$/i

function isGround(name) {
  return GROUND.test(String(name ?? ''))
}

/**
 * The electrical shape of a net, in the units that generalise across boards.
 *
 * Absolute pad counts do not compare between a 200-pad wafer and a 15 000-pad
 * console board, so each is stored as its logarithm; the rest are ratios and
 * small integers, which do compare.
 *
 * @param {object} board the stored board model
 * @param {string} netName
 * @returns {{pads: number, parts: number, multi: number, deco: number, share: number}|null}
 */
export function netSignature(board, netName) {
  const pins = board?.pins ?? []
  const parts = board?.parts ?? []
  const perPart = new Map()
  let pads = 0
  const partIndexes = new Set()

  for (let index = 0; index < pins.length; index += 1) {
    const pin = pins[index]
    if (pin?.net !== netName) continue
    pads += 1
    partIndexes.add(pin.part)
    perPart.set(pin.part, (perPart.get(pin.part) ?? 0) + 1)
  }
  if (pads === 0) return null

  let multi = 0
  let biggest = 0
  for (const count of perPart.values()) {
    if (count >= 2) multi += 1
    if (count > biggest) biggest = count
  }

  // Decoupling capacitors: a two-pin part with one pad here and one on ground.
  // This is the shape of a supply rail, and it survives renaming.
  let deco = 0
  for (const [partIndex, count] of perPart) {
    if (count !== 1) continue
    const part = parts[partIndex]
    if (!part) continue
    let other = null
    let pairs = 0
    for (const pin of pins) {
      if (pin.part !== partIndex) continue
      pairs += 1
      if (pin.net !== netName) other = pin.net
    }
    if (pairs === 2 && other && isGround(other)) deco += 1
  }

  return {
    pads: Math.round(Math.log2(pads + 1) * 100) / 100,
    parts: Math.round(Math.log2(partIndexes.size + 1) * 100) / 100,
    multi: Math.round(Math.log2(multi + 1) * 100) / 100,
    deco: Math.round(Math.log2(deco + 1) * 100) / 100,
    share: Math.round((biggest / pads) * 1000) / 1000,
  }
}

/**
 * How alike two net shapes are, 0…1.
 *
 * A rail's reach matters most, then how widely it spreads, then how many caps
 * hang off it; the share of the largest device separates a supply that feeds
 * one big chip from one that feeds a field of small parts.
 */
export function signatureSimilarity(a, b) {
  if (!a || !b) return 0
  const weighted = [
    [a.pads, b.pads, 2.4, 6],
    [a.parts, b.parts, 1.6, 5],
    [a.multi, b.multi, 1.2, 4],
    [a.deco, b.deco, 1.4, 5],
    [a.share, b.share, 1.2, 1],
  ]
  let total = 0
  let weight = 0
  for (const [x, y, w, span] of weighted) {
    const distance = Math.min(Math.abs(x - y) / span, 1)
    total += w * (1 - distance)
    weight += w
  }
  return Math.round((total / weight) * 1000) / 1000
}

/**
 * The rail names a schematic actually prints.
 *
 * Deliberately separate from the pin-position trick: this is the vocabulary the
 * bench uses, so a net that cannot be proved can still be named in one click
 * from the schematic's own words instead of the technician typing `PP1V8_S0`
 * from a photograph of a page.
 *
 * @param {object} schematic the stored schematic text layer
 * @param {object} [options]
 * @param {number} [options.limit] names returned (default 32)
 * @returns {{name: string, mentions: number, pages: number[], voltage: number|null}[]}
 */
export function railVocabulary(schematic, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : 32
  const seen = new Map()
  for (const page of schematic?.pages ?? []) {
    const text = String(page?.text ?? '')
    if (text.length === 0) continue
    for (const raw of text.split(/[\s\n\r\t]+/)) {
      const token = raw.replace(/[^A-Za-z0-9_+.,-]/g, '')
      // `+5V` is three characters and is a rail.
      if (token.length < 3 || token.length > 28) continue
      const upper = token.toUpperCase()
      if (isGround(upper) || NO_CONNECT.test(upper)) continue
      // A designator is not a rail.
      if (/^[A-Z]{1,3}\d{1,5}$/.test(upper)) continue
      const supply = SUPPLY_TOKEN.test(upper)
      const volted = VOLTAGE_NAMED.test(upper) || VOLTAGE_BARE.test(upper)
      if (!supply && !volted) continue
      // `VDDCR_GFX_A12` is a per-pin label, handled by pin positions, not a
      // rail name — but `PP1V8_S0` and `SOC_V33_S5` end in a power-state code,
      // not a position, and are real rails.
      const positionLike = /^([A-Z][A-Z0-9_]*)_[A-Z]{1,2}\d{1,2}$/.exec(upper)
      if (positionLike && SUPPLY_TOKEN.test(positionLike[1]) && !/\d{1,2}V/i.test(positionLike[1])) continue
      let entry = seen.get(upper)
      if (!entry) {
        entry = { name: upper, mentions: 0, pages: new Set() }
        seen.set(upper, entry)
      }
      entry.mentions += 1
      entry.pages.add(page.page)
    }
  }
  const { byStem } = voltageTokens(schematic)
  const voltsFor = (name) => {
    // The voltage a name carries, either in its own spelling or by stem lookup.
    const direct = /(\d{1,2}(?:[.,]\d{1,2})?)V/i.exec(name)
    if (direct) {
      const value = Number(direct[1].replace(',', '.'))
      if (value >= 0.3 && value <= 24) return value
    }
    const hit = voltageForSupply({ byStem }, name)
    return hit ? hit.volts : null
  }
  const scored = []
  for (const entry of seen.values()) {
    const name = entry.name
    if (CONTROL_SIGNAL.test(name)) continue
    const voltage = voltsFor(name)
    // Specificity beats frequency: a rail named with its voltage and its domain
    // (`1.35V_G6_VMEMIO`) is a far better offer than a word every page repeats.
    let score = Math.log2(entry.mentions + 1)
    score += Math.min(name.length / 6, 3)
    if (voltage !== null) score += 3
    if (name.includes('_')) score += 1
    if (GENERIC_RAIL.test(name)) score -= 3
    if (/^(VDD|VCC)[A-Z0-9]{2,}$/.test(name)) score += 0.5
    scored.push({
      name,
      mentions: entry.mentions,
      pages: [...entry.pages].sort((a, b) => a - b).slice(0, 6),
      voltage,
      score: Math.round(score * 100) / 100,
    })
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit)
}

/** Rail groups worth offering a name for: the biggest unnamed nets. */
function unnamedRails(board, labels, limit) {
  const nets = [...(board?.nets ?? [])]
    .filter((net) => !isGround(net.name) && !NO_CONNECT.test(net.name) && !net.ground)
    .filter((net) => !labels?.[net.name]?.label)
    .sort((a, b) => b.pins.length - a.pins.length)
  return nets.slice(0, limit)
}

/**
 * Everything the engine concludes about one board.
 *
 * @param {object} options
 * @param {object} options.board the stored board model
 * @param {object} options.schematic the stored schematic text layer (may be null)
 * @param {Record<string, object>} options.labels rail labels already recorded
 * @param {object[]} options.library prior rails learned from other boards
 * @param {number} [options.suggestions] unnamed rails to offer names for (default 6)
 * @returns {{applied: object[], suggestions: object[], vocabulary: object[], notes: string[]}}
 */
export function planRailNames({ board, schematic, labels = {}, library = [], suggestions = 6 }) {
  const applied = []
  const offered = []
  const notes = []
  const unmatched = []
  // Only a name that did not come from the schematic is final here: a proved
  // name is re-asserted on every run so its evidence and voltage stay current.
  const taken = new Set(
    Object.entries(labels)
      .filter(([, entry]) => entry?.label && entry.source !== 'schematic')
      .map(([net]) => net),
  )

  // 1 + 2. What the schematic can prove.
  if (schematic) {
    let proof = { assignments: [] }
    try {
      proof = matchSchematicRails(board, schematic)
    } catch (error) {
      notes.push(`the schematic could not be fingerprinted: ${error?.message ?? error}`)
    }
    // Supplies the schematic knows about that no net could claim: shown so the
    // bench can see what is still unresolved rather than assuming there is none.
    const assignedRailNames = new Set(proof.assignments.map((assignment) => assignment.rail))
    try {
      const { rails } = ballLabelledRails(schematic)
      for (const rail of rails) {
        if (assignedRailNames.has(rail.name)) continue
        unmatched.push({ name: rail.name, pins: rail.pins })
      }
    } catch {
      // ballLabelledRails already reported why through the proof path.
    }
    for (const assignment of proof.assignments) {
      if (taken.has(assignment.net)) continue
      applied.push({
        net: assignment.net,
        rail: assignment.rail,
        voltage: assignment.voltage ?? null,
        confidence: assignment.confidence,
        source: 'schematic',
        evidence: assignment.evidence,
      })
      taken.add(assignment.net)
    }
  }

  // 3. What other boards already taught us.
  const priorSuggestions = []
  if (library.length > 0) {
    for (const net of unnamedRails(board, labels, 12)) {
      const signature = netSignature(board, net.name)
      if (!signature) continue
      const scored = library
        .map((entry) => ({ entry, score: signatureSimilarity(signature, entry.signature) }))
        .filter((row) => row.score >= 0.8)
        .sort((a, b) => b.score - a.score)
      if (scored.length === 0) continue
      const best = scored[0]
      const runnerUp = scored.find((row) => row.entry.name !== best.entry.name)
      const margin = runnerUp ? best.score - runnerUp.score : 1
      const sameVolts = best.entry.voltage !== null && labels[net.name]?.voltage === best.entry.voltage
      // A name learned from another board is never written down on its own: a
      // different board can share a shape and be a different rail. It is always
      // a one-click suggestion with the other board as the citation.
      priorSuggestions.push({
        net: net.name,
        rail: best.entry.name,
        source: 'prior-board',
        confidence: 'suggestion',
        reason: `shape matches a rail named ${best.entry.name} on another board (${Math.round(best.score * 100)}%, next best ${Math.round((runnerUp?.score ?? 0) * 100)}%)`,
        evidence: [],
        alternatives: scored
          .filter((row) => row.entry.name !== best.entry.name)
          .slice(0, 2)
          .map((row) => row.entry.name),
        volts: sameVolts,
      })
    }
  }

  // 4. The schematic's own vocabulary, for whatever is still nameless.
  const vocabulary = schematic ? railVocabulary(schematic, { limit: 24 }) : []
  const unnamed = unnamedRails(board, labels, suggestions).filter((net) => !taken.has(net.name))
  const vocabularySuggestions = []
  if (vocabulary.length > 0) {
    for (const net of unnamed) {
      const prior = priorSuggestions.find((entry) => entry.net === net.name)
      if (prior) {
        // A prior beats a bare word list: keep the choice but decorate it.
        prior.choices = [
          prior.rail,
          ...(prior.alternatives ?? []),
          ...vocabulary
            .filter((word) => ![prior.rail, ...(prior.alternatives ?? [])].includes(word.name))
            .slice(0, Math.max(0, 2))
            .map((word) => word.name),
        ].slice(0, 4)
        continue
      }
      vocabularySuggestions.push({
        net: net.name,
        rail: null,
        source: 'vocabulary',
        confidence: 'suggestion',
        reason: 'the schematic prints these rail names; pick the one this net is',
        choices: vocabulary.slice(0, 4).map((word) => word.name),
        evidence: [],
      })
    }
  }

  offered.push(...priorSuggestions, ...vocabularySuggestions)
  if (!schematic) notes.push('no schematic attached: only prior boards can suggest a name')
  return { applied, suggestions: offered, vocabulary, unmatched, notes }
}

/**
 * Turn applied names into the stored label shape.
 *
 * Kept separate so the caller decides policy (bench labels win, and so on)
 * while the engine stays a pure function of the record.
 */
export function labelEntriesFor(applied) {
  return applied.map((entry) => ({
    net: entry.net,
    label: entry.rail,
    voltage: entry.voltage ?? null,
    source: entry.source,
    confidence: entry.confidence,
    evidence: entry.evidence ?? [],
  }))
}

/** Vocabulary, for the tool and the panel to show as choices. */
export function vocabularyCandidates(schematic, limit = 8) {
  return railVocabulary(schematic, { limit }).map((word) => word.name)
}

export { ballLabelledRails }
