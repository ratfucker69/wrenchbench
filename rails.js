/**
 * Rail classification for WrenchBench.
 *
 * Two populations of boardview exist on a bench and they need the same feature
 * to behave sensibly:
 *
 *   - Exports that name their rails (`+3V3`, `PP1V8_S0`, `VDD_18_S5`). The
 *     voltage is in the string and is read out of it.
 *   - Exports that do not (`Net72`, `SNet15`). This is common on vendor
 *     dumps, and the PS5 EDM-010 file is entirely of this kind: 1817 nets, not
 *     one of them carrying a voltage.
 *
 * So a rail group is decided by fan-out as well as by name: on a real
 * motherboard the nets with the most pads are the power distribution and the
 * planes, because a rail by definition reaches many pins. That gives a
 * meaningful colour grouping on a nameless export, labelled honestly with the
 * net name and pad count rather than an invented voltage.
 *
 * Nothing here invents a voltage. `voltage` is null when the file does not say.
 */

/** Nets that are never a rail group. */
const GROUND_PATTERN = /^(GND|GROUND|VSS|AGND|DGND|PGND|GND_?[A-Z0-9]*)$/i
const NO_CONNECT_PATTERN = /^(NC|N\.?C\.?|DNC|NO_?CONNECT|RESERVED)$/i

/**
 * Read a supply voltage out of a net name.
 *
 * Handles the four spellings these exports actually use, in order:
 *   3V3 / 1V8 / 5V0   digits either side of the V
 *   3.3V / 1.8V       a decimal with a trailing V
 *   +5V / -12V        whole volts with a sign
 *   VDD_18 / VDD_33   an underscore-separated pair under a supply prefix
 *
 * @returns {number|null} volts, or null when the name does not encode one
 */
export function voltageOf(name) {
  const text = String(name ?? '').toUpperCase()
  if (GROUND_PATTERN.test(text) || NO_CONNECT_PATTERN.test(text)) return null

  const plausible = (value) => (value >= 0.4 && value <= 24 ? Math.round(value * 100) / 100 : null)

  // 3.3V, 1.8V
  const decimal = text.match(/(\d)[.,](\d)\s*V\b/)
  if (decimal) {
    const value = plausible(Number(`${decimal[1]}.${decimal[2]}`))
    if (value !== null) return value
  }

  // 3V3, 1V8, 5V0, 0V9 — but not "Net72" (no V) and not "S5V"
  const between = text.match(/(?:^|[^0-9])(\d)V(\d)(?![0-9])/)
  if (between) {
    const value = plausible(Number(`${between[1]}.${between[2]}`))
    if (value !== null) return value
  }

  // +5V, 12V, -12V
  const whole = text.match(/(?:^|[^0-9A-Z])([+-]?)(\d{1,2})V(?![0-9A-Z])/)
  if (whole) {
    const amount = Number(whole[2])
    const value = plausible(whole[1] === '-' ? -amount : amount)
    if (value !== null) return value
  }

  // VDD_18, VDD_33, VCC_05 — the pair is a decimal under a supply prefix.
  const prefixed = text.match(/^(?:VDD|VCC|VEE|AVDD|DVDD|PVDD|VPH|VIO|VBAT|V_)[A-Z]*_(\d{2})(?![0-9])/)
  if (prefixed) {
    const value = plausible(Number(`${prefixed[1][0]}.${prefixed[1][1]}`))
    if (value !== null) return value
  }

  return null
}

/** A stable colour per rail, distinguishable on light and dark surfaces. */
const RAIL_COLOURS = [
  '#4e9fd1',
  '#d98a3d',
  '#5caf72',
  '#c46bb0',
  '#8f7fd4',
  '#3fb0a8',
  '#cf6b5c',
  '#a8a63c',
  '#6f8fd8',
  '#d0763f',
  '#7cb98f',
  '#b98ccc',
]

/**
 * The short, bench-friendly spelling of a rail voltage: `1.0 V`, `1.35 V`,
 * `3.3 V`, `12 V`.
 *
 * A technician asks for "the 3.3" and "the 12", not for `PP1V8_S0`, so the
 * voltage is what the legend leads with once it is known. One decimal is kept
 * for whole volts under ten so `1` reads as `1.0` and cannot be mistaken for
 * pin 1.
 */
export function formatVoltage(volts) {
  if (typeof volts !== 'number' || !Number.isFinite(volts)) return null
  const rounded = Math.round(volts * 100) / 100
  // Whole volts print plainly ("5 V", "12 V"); one volt keeps a decimal so it
  // cannot be read as a pin number ("1.0 V").
  const text = rounded === 1 ? '1.0' : String(rounded)
  return `${text} V`
}

/**
 * Make sure every rail the technician has named is actually in the rail list.
 *
 * The rail groups are chosen by pad count, so a rail that was named from the
 * schematic but reaches few pads (`VDDCR_SOC`, 51) would otherwise be labelled
 * in the record and missing from the legend and the triage choices — the worst
 * of both worlds. Named rails are appended in pad order, keeping the colours of
 * the groups already chosen.
 *
 * @param {object} board the stored board model
 * @param {object[]} rails the classified rail groups, mutated in place
 * @param {Record<string, object>} labels net -> stored label entry
 * @returns {object[]} the same array
 */
export function ensureLabelledRails(board, rails, labels) {
  if (!labels) return rails
  const present = new Set(rails.map((rail) => rail.name))
  const extra = []
  for (const [net, entry] of Object.entries(labels)) {
    if (!entry?.label) continue
    if (present.has(net)) continue
    // Ground and no-connect nets are never rails, labelled or not.
    if (GROUND_PATTERN.test(net) || NO_CONNECT_PATTERN.test(net)) continue
    const known = (board?.nets ?? []).find((candidate) => candidate.name === net)
    if (!known || known.ground) continue
    extra.push({
      name: net,
      pads: known.pins?.length ?? 0,
      voltage: typeof entry.voltage === 'number' ? entry.voltage : voltageOf(entry.label),
      label: entry.label,
      alias: null,
      colour: RAIL_COLOURS[(rails.length + extra.length) % RAIL_COLOURS.length],
      reach: 0,
      namedOutOfGroup: true,
    })
  }
  extra.sort((a, b) => b.pads - a.pads || a.name.localeCompare(b.name))
  rails.push(...extra)
  return rails
}

/**
 * Rank the nets of one board into rail groups.
 *
 * A net qualifies when it is neither ground nor a no-connect, and either the
 * name encodes a voltage or its fan-out is at least `threshold` pads.
 *
 * @param {object} board the stored board model
 * @param {object} [options]
 * @param {number} [options.limit] maximum rail groups returned (default 12)
 * @returns {{rails: object[], byPadCount: Map<number, string>, threshold: number}}
 */
export function classifyRails(board, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(options.limit, RAIL_COLOURS.length)) : RAIL_COLOURS.length
  const totalPads = board?.pins?.length ?? 0
  // A rail reaches far more pins than a signal. 0.4% of the pads, floored, so a
  // small board still groups and a large one is not swamped by local nets.
  const threshold = Math.max(8, Math.round(totalPads * 0.004))

  const candidates = []
  for (const net of board?.nets ?? []) {
    if (GROUND_PATTERN.test(net.name) || NO_CONNECT_PATTERN.test(net.name)) continue
    if (net.ground) continue
    const voltage = voltageOf(net.name)
    const pads = net.pins.length
    if (voltage === null && pads < threshold) continue
    candidates.push({ name: net.name, pads, voltage, pins: net.pins })
  }

  // Voltage-named rails first (a file that names its rails has answered the
  // question), then by reach.
  candidates.sort((a, b) => {
    if ((a.voltage === null) !== (b.voltage === null)) return a.voltage === null ? 1 : -1
    return b.pads - a.pads
  })

  const rails = candidates.slice(0, limit).map((candidate, index) => ({
    ...candidate,
    label: candidate.name,
    alias: null,
    colour: RAIL_COLOURS[index % RAIL_COLOURS.length],
    // Which share of the board's pads the rail reaches.
    reach: totalPads > 0 ? Math.round((candidate.pads / totalPads) * 1000) / 10 : 0,
  }))

  const byPadCount = new Map()
  for (const rail of rails) byPadCount.set(rail.name, rail)

  return { rails, byPadCount, threshold }
}

/**
 * Assign every component to the rail it most plausibly draws from.
 *
 * The rule: among a component's nets, ignore ground and no-connect, prefer a
 * rail whose name carries a voltage, and break ties by reach. A decoupling
 * capacitor therefore lands on the rail it decouples rather than on ground,
 * and an IC lands on its widest supply.
 *
 * @returns {{assignment: Map<number, string>, rails: object[], threshold: number, byNet: Map<string, object>}}
 */
export function assignComponentRails(board, options = {}) {
  const { rails, byPadCount, threshold } = classifyRails(board)
  applyAliases(rails, options.aliases)
  const assignment = new Map()

  for (let partIndex = 0; partIndex < (board?.parts?.length ?? 0); partIndex += 1) {
    assignment.set(partIndex, null)
  }

  // Index a component's nets once.
  const netsByPart = new Map()
  for (let pinIndex = 0; pinIndex < (board?.pins?.length ?? 0); pinIndex += 1) {
    const pin = board.pins[pinIndex]
    if (!pin.net) continue
    const rail = byPadCount.get(pin.net)
    if (!rail) continue
    let entry = netsByPart.get(pin.part)
    if (!entry) {
      entry = new Map()
      netsByPart.set(pin.part, entry)
    }
    const existing = entry.get(rail.name)
    if (!existing || rail.pads > existing.pads) entry.set(rail.name, rail)
  }

  for (const [partIndex, nets] of netsByPart) {
    let best = null
    for (const rail of nets.values()) {
      if (!best) {
        best = rail
        continue
      }
      const bestHasVoltage = best.voltage !== null
      const railHasVoltage = rail.voltage !== null
      if (railHasVoltage !== bestHasVoltage) {
        if (railHasVoltage) best = rail
        continue
      }
      if (rail.pads > best.pads) best = rail
    }
    assignment.set(partIndex, best ? best.name : null)
  }

  return { assignment, rails, threshold, byNet: byPadCount }
}

// ---------------------------------------------------------------------------
// Schematic-assisted rail naming
// ---------------------------------------------------------------------------

/**
 * A rail token as schematics actually print it.
 *
 * The alternation is anchored on the supply prefixes that carry a voltage, and
 * the digit requirement plus the refdes-shape rejection below keep part labels
 * (`C1234`, `U7001`) out of the rail namespace.
 */
const RAIL_TOKEN_PATTERN =
  /\b(?:PP|PVDD|AVDD|DVDD|VDD|VCC|VEE|VPH|VBAT|VREG|LDO|VIO|VSYS|VBUS|V_)[A-Z0-9_]{1,18}\b/gi
const REFDES_PATTERN = /\b[A-Z]{1,3}\d{1,5}\b/g
/** How far from a part label a rail label may sit and still be its supply. */
const ALIAS_WINDOW = 420

function railTokensOf(text) {
  const tokens = []
  RAIL_TOKEN_PATTERN.lastIndex = 0
  let match
  while ((match = RAIL_TOKEN_PATTERN.exec(text)) !== null) {
    const token = match[0].toUpperCase()
    if (token.length < 4) continue
    if (!/\d/.test(token)) continue
    // A refdes that happens to start with V (V12, V3) is not a rail.
    if (/^[A-Z]{1,2}\d{1,4}$/.test(token)) continue
    // Require either a decodable voltage or a supply-shaped body.
    if (voltageOf(token) === null && !/(VDD|VCC|VPH|VBAT|VSYS|VBUS|PP\d)/.test(token)) continue
    tokens.push({ token, at: match.index })
  }
  return tokens
}

function refdesAt(pattern, text) {
  const found = []
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(text)) !== null) found.push({ refdes: match[0].toUpperCase(), at: match.index })
  return found
}

function nearestTokens(tokens, at) {
  // Tokens are in document order, so a binary search finds the window.
  let low = 0
  let high = tokens.length - 1
  let start = tokens.length
  while (low <= high) {
    const mid = (low + high) >> 1
    if (tokens[mid].at >= at - ALIAS_WINDOW) {
      start = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  const near = []
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].at > at + ALIAS_WINDOW) break
    near.push(tokens[index].token)
  }
  return near
}

/**
 * Name the opaque rails of a board from its schematic text layer.
 *
 * The PS5 EDM-010 export calls every net `NetNNN`, so the boardview alone can
 * never say which of them is 1.8 V. The schematic can: a decoupling cap is
 * drawn beside the rail it sits on, so a part's refdes repeatedly appears near
 * one rail label and rarely near the others. Three independent parts of the
 * same net agreeing on one label is the signal; one is a coincidence.
 *
 * This is inference, not ground truth, so it is reported as such: each alias
 * carries the parts that voted for it, and nothing is assigned without at least
 * three. Callers must keep the real net name; the alias is a label.
 *
 * @param {object} board the stored board model
 * @param {object} schematic the extracted schematic text layer
 * @param {object} [options]
 * @param {number} [options.maxRefdesPerNet] cap on parts examined per net (default 80)
 * @returns {Map<string, {label: string, voltage: number|null, votes: number, via: string[]}>}
 */
export function deriveRailAliases(board, schematic, options = {}) {
  const aliases = new Map()
  const pages = schematic?.pages
  if (!Array.isArray(pages) || pages.length === 0) return aliases
  const maxRefdes = Number.isFinite(options.maxRefdesPerNet) ? options.maxRefdesPerNet : 80

  const { rails } = classifyRails(board)
  const opaque = rails.filter((rail) => voltageOf(rail.name) === null)
  if (opaque.length === 0) return aliases

  // Which parts sit on each opaque rail, and where does each part appear?
  const refdesSet = new Set()
  const partsOfRail = new Map()
  for (const rail of opaque) {
    const wanted = new Set()
    for (const pin of rail.pins ?? []) {
      const part = board.parts?.[pin.part]
      if (!part) continue
      if (wanted.size >= maxRefdes) break
      wanted.add(String(part.refdes).toUpperCase())
    }
    partsOfRail.set(rail.name, wanted)
    for (const refdes of wanted) refdesSet.add(refdes)
  }

  const pagesOfRefdes = new Map()
  for (const page of pages) {
    const text = String(page.text ?? '')
    if (text.length === 0) continue
    const tokens = railTokensOf(text)
    if (tokens.length === 0) continue
    for (const hit of refdesAt(REFDES_PATTERN, text)) {
      if (!refdesSet.has(hit.refdes)) continue
      let votes = pagesOfRefdes.get(hit.refdes)
      if (!votes) {
        votes = new Map()
        pagesOfRefdes.set(hit.refdes, votes)
      }
      for (const token of nearestTokens(tokens, hit.at)) votes.set(token, (votes.get(token) ?? 0) + 1)
    }
  }

  for (const rail of opaque) {
    const tallies = new Map()
    let seen = 0
    for (const refdes of partsOfRail.get(rail.name) ?? []) {
      const votes = pagesOfRefdes.get(refdes)
      if (!votes) continue
      seen += 1
      for (const [token, count] of votes) {
        let tally = tallies.get(token)
        if (!tally) {
          tally = { token, parts: new Set(), weight: 0 }
          tallies.set(token, tally)
        }
        tally.parts.add(refdes)
        tally.weight += count
      }
    }
    if (seen === 0) continue

    const ranked = [...tallies.values()].sort((a, b) => {
      if (b.parts.size !== a.parts.size) return b.parts.size - a.parts.size
      return b.weight - a.weight
    })
    const best = ranked[0]
    if (!best) continue
    // Three independent parts, and a clear margin over the runner-up. One
    // shared power page is not evidence; a rail label drawn beside its caps is.
    if (best.parts.size < 3) continue
    const runnerUp = ranked[1]
    if (runnerUp && best.parts.size < runnerUp.parts.size * 1.5) continue

    aliases.set(rail.name, {
      label: best.token,
      voltage: voltageOf(best.token),
      votes: best.parts.size,
      via: [...best.parts].slice(0, 6),
    })
  }

  return aliases
}

/** Attach alias labels to rail objects without touching their real net names. */
function applyAliases(rails, aliases) {
  if (!aliases || aliases.size === 0) {
    for (const rail of rails) {
      rail.label = rail.name
      rail.alias = null
    }
    return
  }
  for (const rail of rails) {
    const alias = aliases.get(rail.name)
    rail.label = alias ? alias.label : rail.name
    rail.alias = alias ?? null
    if (rail.voltage === null && alias?.voltage != null) rail.voltage = alias.voltage
  }
}
