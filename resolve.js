/**
 * Natural-language resolution for WrenchBench.
 *
 * A technician says "the big chip on the 3V3 rail", "the coil near U1", "the
 * HDMI transmitter", "shorted cap". None of those are a refdes, and guessing one
 * is exactly how an agent invents a part that is not on the board.
 *
 * So this module turns a description into *ranked candidates with reasons* and
 * nothing else. Every candidate is a real object from the board record, every
 * score has a human-readable justification, and the caller (the agent) is
 * expected to confirm or ask before acting.
 *
 * It reads only the board model, the alias table and the rail labels, so it is
 * deterministic and testable without a model call.
 */

import { classifyRails } from './rails.js'

/** Words that describe a supply or a return rather than a signal. */
const SUPPLY_HINT = /(power|supply|rail|vcc|vdd|vbus|vsys|voltage|lvds|main)/i
const GROUND_HINT = /(ground|gnd|earth|return|short to ground|shorted to ground)/i
const SHORT_HINT = /(short|shorted|bridge|bridged|leak|leaky)/i

/** "290 pad chip", "48-pin", "200 balls" — a size stated as a number. */
const PIN_COUNT_PATTERN = /\b(\d{1,4})\s*(?:-?\s*)?(?:pad|pads|pin|pins|ball|balls|bga)\b/i

/** "near U12" / "next to C7" / "by the coil" */
const NEAR_PATTERN = /\b(?:near|next to|beside|by|around|close to)\s+([A-Za-z]{1,3}\d{1,5})\b/i
/** "the biggest chip", "large", "fattest" */
const BIG_PATTERN = /\b(big|biggest|large|largest|fattest|huge|biggest|main|soc|cpu)\b/i
const SMALL_PATTERN = /\b(small|smallest|tiny)\b/i

/** Words that carry no identity on their own. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'on', 'in', 'at', 'of', 'to', 'is', 'it', 'its', 'this', 'that', 'there', 'here',
  'and', 'or', 'for', 'with', 'from', 'my', 'me', 'i', 'we', 'you', 'board', 'chip', 'component',
  'part', 'pad', 'pin', 'net', 'rail', 'dead', 'no', 'not', 'nothing', 'working', 'broken', 'please',
  'find', 'show', 'mark', 'check', 'look', 'what', 'which', 'where', 'help', 'can', 'could', 'should',
])

function tokensOf(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_.+-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
}

/** Ground / supply classification for a net, from its own record first. */
function netKind(net, railNames) {
  if (net?.ground) return 'ground'
  if (net?.power) return 'power'
  if (railNames.has(net?.name)) return 'power'
  return 'signal'
}

function familyOf(refdes) {
  return (String(refdes ?? '').toUpperCase().match(/^[A-Z]+/) ?? [''])[0]
}

/** Plain-language family names, so "cap" or "coil" resolves. */
const FAMILY_WORDS = {
  cap: 'C',
  capacitor: 'C',
  caps: 'C',
  resistors: 'R',
  res: 'R',
  resistor: 'R',
  coil: 'L',
  inductor: 'L',
  choke: 'L',
  diode: 'D',
  transistor: 'Q',
  fet: 'Q',
  mosfet: 'Q',
  connector: 'J',
  socket: 'J',
  header: 'J',
  crystal: 'Y',
  oscillator: 'Y',
  fuse: 'F',
  ferrite: 'FB',
}

/**
 * Resolve one description to candidate parts and nets.
 *
 * @param {object} board the stored board model
 * @param {object} context
 * @param {Record<string, {alias: string|null}>} [context.aliases]
 * @param {Record<string, {label: string}>} [context.railLabels]
 * @param {string} context.query the technician's words
 * @param {number} [context.limit] candidates per kind (default 6)
 * @returns {{parts: object[], nets: object[], notes: string[], interpreted: object}}
 */
export function resolveQuery(board, context = {}) {
  const query = String(context.query ?? '').trim()
  const limit = Math.min(Math.max(Number(context.limit) || 6, 1), 20)
  const aliases = context.aliases ?? {}
  const railLabels = context.railLabels ?? {}
  const notes = []
  if (query.length === 0) return { parts: [], nets: [], notes: ['no query'], interpreted: {} }

  // Rail groups, not "every net". Using all net names makes every net look
  // like a supply rail, which is how "3v3 supply" ends up matching NC.
  const railNames = new Set(classifyRails(board).rails.map((rail) => rail.name))
  const nearMatch = query.match(NEAR_PATTERN)
  const anchorRefdes = nearMatch ? nearMatch[1].toUpperCase() : null
  // The anchor is context ("near C01"), not the thing being looked for.
  const tokens = tokensOf(query).filter((token) => !anchorRefdes || token.toUpperCase() !== anchorRefdes)
  const wantsBig = BIG_PATTERN.test(query)
  const wantsSmall = SMALL_PATTERN.test(query)
  const wantsGround = GROUND_HINT.test(query)
  const wantsSupply = SUPPLY_HINT.test(query)
  const wantsShort = SHORT_HINT.test(query)

  // Family words: "caps", "coils", "the diode" — plurals and -es forms too.
  const familyWanted = new Set()
  for (const token of tokens) {
    const family =
      FAMILY_WORDS[token] ?? FAMILY_WORDS[token.replace(/es$/, '')] ?? FAMILY_WORDS[token.replace(/s$/, '')]
    if (family) familyWanted.add(family)
  }

  // A size stated as a number is the strongest identity in the whole query.
  const pinCountMatch = query.match(PIN_COUNT_PATTERN)
  const wantedPins = pinCountMatch ? Number(pinCountMatch[1]) : null

  // Distance anchor, if the description names a part to be near.
  let anchorCentre = null
  if (anchorRefdes) {
    const anchor = (board?.parts ?? []).find((part) => String(part.refdes).toUpperCase() === anchorRefdes)
    if (anchor) {
      anchorCentre = { x: (anchor.bbox.x1 + anchor.bbox.x2) / 2, y: (anchor.bbox.y1 + anchor.bbox.y2) / 2 }
    } else {
      notes.push(`no component "${nearMatch[1]}" to search near`)
    }
  }

  const maxPins = (board?.parts ?? []).reduce((best, part) => Math.max(best, part.pins), 0)
  const unitsToMm = board?.units === 'mm' ? 1 : 0.0254

  const parts = []
  for (let partIndex = 0; partIndex < (board?.parts ?? []).length; partIndex += 1) {
    const part = board.parts[partIndex]
    const refdes = String(part.refdes ?? '')
    const upper = refdes.toUpperCase()
    const alias = aliases[refdes]?.alias ?? null
    const aliasUpper = alias ? String(alias).toUpperCase() : ''
    const value = String(part.value ?? '')
    const valueUpper = value.toUpperCase()
    const family = familyOf(refdes)
    const reasons = []
    let score = 0

    // Exact identities first, and say which namespace matched: the technician
    // may be reading either the schematic name or the boardview label.
    const exact = query.toUpperCase()
    if (aliasUpper && aliasUpper === exact) {
      score += 120
      reasons.push(`schematic name ${alias} (boardview label ${refdes})`)
    } else if (upper === exact) {
      score += 120
      reasons.push(`exact boardview label ${refdes}`)
    }

    for (const token of tokens) {
      const tokenUpper = token.toUpperCase()
      if (upper === tokenUpper) {
        score += 90
        reasons.push(`refdes ${refdes}`)
      } else if (upper.startsWith(tokenUpper) && tokenUpper.length >= 3) {
        score += 26
        reasons.push(`refdes starts with ${token}`)
      }
      if (aliasUpper && aliasUpper === tokenUpper) {
        score += 90
        reasons.push(`named ${alias} from the schematic`)
      } else if (aliasUpper && aliasUpper.includes(tokenUpper) && tokenUpper.length >= 3) {
        score += 30
        reasons.push(`named ${alias}`)
      }
      if (valueUpper && valueUpper === tokenUpper) {
        score += 70
        reasons.push(`marking ${value}`)
      } else if (valueUpper && tokenUpper.length >= 3 && valueUpper.includes(tokenUpper)) {
        score += 34
        reasons.push(`marking ${value} contains ${token}`)
      }
    }

    // Family words.
    if (familyWanted.size > 0) {
      if (familyWanted.has(family)) {
        score += 30
        reasons.push(`is a ${family}`)
      } else {
        // A description that names a family excludes everything else.
        score -= 60
      }
    }

    // Size language ranks every part by size instead of picking one, so the
    // technician gets a shortlist of the biggest rather than a single guess.
    if (wantsBig) {
      const fraction = maxPins > 0 ? part.pins / maxPins : 0
      if (part.pins >= Math.max(16, maxPins * 0.2)) {
        score += 12 + Math.round(fraction * 34)
        reasons.push(`${part.pins} pads — the largest on this board has ${maxPins}`)
      }
    }
    if (wantsSmall) {
      if (part.pins > 0 && part.pins <= 2) {
        score += 18
        reasons.push(`${part.pins}-pad part`)
      } else if (part.pins > 8) {
        score -= 12
      }
    }

    // Proximity to a named part, but never the anchor itself.
    if (anchorCentre && upper !== anchorRefdes) {
      const dx = (part.bbox.x1 + part.bbox.x2) / 2 - anchorCentre.x
      const dy = (part.bbox.y1 + part.bbox.y2) / 2 - anchorCentre.y
      const mm = Math.hypot(dx, dy) * unitsToMm
      if (mm <= 6) {
        score += 34
        reasons.push(`${mm.toFixed(1)} mm from ${anchorRefdes}`)
      } else if (mm <= 15) {
        score += 16
        reasons.push(`${mm.toFixed(1)} mm from ${anchorRefdes}`)
      }
    }

    // A supply description prefers parts that already matched something else
    // and happen to sit on a rail. On its own it must not select every part.
    if (wantsSupply && score > 0) {
      const onRail = (board.pins ?? []).some(
        (pin) => pin.part === partIndex && pin.net && (railNames.has(pin.net) || railLabels[pin.net]),
      )
      if (onRail) {
        score += 12
        reasons.push('sits on a rail')
      }
    }

    // An explicit pad count.
    if (wantedPins !== null) {
      if (part.pins === wantedPins) {
        score += 60
        reasons.push(`exactly ${wantedPins} pads`)
      } else if (Math.abs(part.pins - wantedPins) <= 2) {
        score += 12
        reasons.push(`${part.pins} pads, close to ${wantedPins}`)
      } else {
        score -= 40
      }
    }

    if (score > 0 && reasons.length > 0) {
      parts.push({
        refdes,
        label: alias ?? refdes,
        partIndex,
        pins: part.pins,
        value: value || null,
        layer: part.layer,
        score,
        reasons: [...new Set(reasons)].slice(0, 4),
      })
    }
  }

  parts.sort((a, b) => b.score - a.score || a.refdes.localeCompare(b.refdes))

  // A boardview can carry the same designator twice (a duplicate body or a
  // two-sided export). Keep the strongest, but say so rather than hiding it.
  const seenRefdes = new Map()
  const uniqueParts = []
  let duplicates = 0
  for (const part of parts) {
    const prior = seenRefdes.get(part.refdes)
    if (prior) {
      duplicates += 1
      continue
    }
    seenRefdes.set(part.refdes, part)
    uniqueParts.push(part)
  }
  if (duplicates > 0) {
    notes.push(`${duplicates} other entr(y/ies) share a designator with the candidates above; the boardview has duplicates`)
  }

  // Nets: name, label, kind, reach.
  const nets = []
  for (const net of board?.nets ?? []) {
    const name = String(net.name ?? '')
    const upper = name.toUpperCase()
    const label = railLabels[name]?.label ?? null
    const labelUpper = label ? String(label).toUpperCase() : ''
    const kind = netKind(net, railNames)
    const reasons = []
    let score = 0

    for (const token of tokens) {
      const tokenUpper = token.toUpperCase()
      if (upper === tokenUpper || labelUpper === tokenUpper) {
        score += 70
        reasons.push(label ? `rail ${label}` : `net ${name}`)
      } else if (upper.includes(tokenUpper) && tokenUpper.length >= 3) {
        score += 26
        reasons.push(`net ${name}`)
      } else if (labelUpper && labelUpper.includes(tokenUpper) && tokenUpper.length >= 3) {
        score += 34
        reasons.push(`rail ${label}`)
      }
    }

    if (wantsGround && kind === 'ground') {
      score += 45
      reasons.push('is the ground plane')
    }
    if (wantsSupply && kind === 'power' && score > 0) {
      score += 30
      reasons.push('is a supply rail')
    }
    if (wantsShort && kind === 'ground') {
      score += 20
      reasons.push('the usual short target')
    }
    if (/\brail\b/i.test(query) && kind === 'power') score += 10

    if (score > 0 && reasons.length > 0) {
      nets.push({
        name,
        label: label ?? name,
        pins: net.pins?.length ?? 0,
        kind,
        score,
        reasons: [...new Set(reasons)].slice(0, 3),
      })
    }
  }
  nets.sort((a, b) => b.score - a.score || b.pins - a.pins || a.name.localeCompare(b.name))

  // A family word alone matches every member of that family, which is not an
  // answer. Say how many there are and what would narrow it.
  const familyOnly =
    parts.length > 0 &&
    parts.every((part) => part.reasons.length === 1 && /^is a [A-Z]+$/.test(part.reasons[0]))
  if (familyOnly) {
    const family = parts[0].reasons[0].slice(5)
    const total = (board?.parts ?? []).filter((part) => familyOf(part.refdes) === family).length
    notes.push(
      `"${query}" only says which family, and there are ${total} of them. Narrow it by the rail it sits on, the part it is near, its pad count, or the pad you actually probed.`,
    )
  }

  // A description about a supply on a board whose nets are all "NetNNN" cannot
  // be answered from the file; the honest move is to say so and name the fix.
  const allNetsAnonymous = (board?.nets ?? []).length > 0 &&
    (board.nets.every((net) => /^Net\d+$|^N\d+$/i.test(net.name)))
  if (wantsSupply && nets.length === 0 && allNetsAnonymous) {
    notes.push(
      'this boardexport names every net NetNNN, so no net says "3V3". Ask which net the technician measured, or read the schematic for the rail name, and record it with wrenchbench_label_rail so the canvas colours it.',
    )
  }

  if (parts.length === 0 && nets.length === 0) {
    notes.push(
      'nothing on this board matches that description. Say what you are looking for in board terms — a refdes, a marking on the part, a rail name, a pin count, or a part it sits near.',
    )
  }

  return {
    parts: uniqueParts.slice(0, limit),
    nets: nets.slice(0, Math.max(3, Math.floor(limit / 2))),
    notes,
    interpreted: {
      tokens,
      families: [...familyWanted],
      near: anchorRefdes,
      wantsBig,
      wantsSmall,
      wantsSupply,
      wantsGround,
      wantsShort,
    },
  }
}
