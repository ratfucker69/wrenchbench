/**
 * Component naming for WrenchBench.
 *
 * A vendor boardview often ships parts it cannot name. The PS5 EDM-010 export
 * has 4321 components called `N16136`, `N15923`… because the label block in the
 * file carries the placeholder and nothing else. On the bench those are the
 * parts you cannot talk about: "check N15887" is useless, "check the VRM
 * controller" is workable.
 *
 * Two rules keep this honest:
 *
 *   1. A refdes is never overwritten. The boardview's own label stays on the
 *      record as `refdes`; a name derived from anywhere else is stored
 *      separately as an `alias` with its evidence.
 *   2. An alias is only assigned when the evidence is unique. Where several
 *      schematic parts match, the candidates are reported and the technician
 *      (or the agent, by asking) decides — this module does not guess.
 *
 * The join is the part's own marking. A boardview value like `XDPE14286A` is a
 * device part number, and a schematic prints it next to its designator; a value
 * like `0.1u` is shared by hundreds of capacitors and therefore proves nothing.
 */

/** A designator the boardview generated because it had no label. */
const PLACEHOLDER_REFDES = /^N\d{1,7}$/i

/** Values that identify a device rather than a loose specification. */
const PART_NUMBER_SHAPE = /^[A-Z0-9][A-Z0-9._/-]{4,}$/i

/** Refdes-shaped token in schematic text. */
const REFDES_TOKEN = /\b(?:IC|U|Q|C|R|L|D|FB|SW|J|CN|X|Y|F|T|VR|PU|PL|PR|PC)\d{1,5}\b/g

const RESISTOR_VALUE = /^\d+(\.\d+)?\s*(R|K|M|E|Ω|OHM|OHMS|KΩ|MΩ)?$/i
const CAPACITOR_VALUE = /^\d+(\.\d+)?\s*(P|N|U|UF|NF|PF|F)(\d{1,2})?$/i
const PACKAGE_VALUE = /^(0\d{3}|[0-9]{4}|SOT|SOIC|QFN|BGA|DFN|SSOP|TSSOP|TO-?\d+|1206|0805|0603|0402|0201)$/i

/**
 * Guess what family a value belongs to, and how much the value proves.
 *
 * `strength` is what the matcher is allowed to do with it: `device` values can
 * name a part outright, `generic` values can only suggest candidates.
 *
 * @returns {{family: string, strength: 'device'|'generic'|'none'}}
 */
export function classifyValue(value) {
  const text = String(value ?? '').trim()
  if (text.length === 0) return { family: 'unknown', strength: 'none' }
  if (PACKAGE_VALUE.test(text)) return { family: 'package', strength: 'none' }
  if (CAPACITOR_VALUE.test(text)) return { family: 'capacitor', strength: 'generic' }
  if (RESISTOR_VALUE.test(text)) return { family: 'resistor', strength: 'generic' }
  if (PART_NUMBER_SHAPE.test(text) && /\d/.test(text) && /[A-Z]/i.test(text)) {
    return { family: 'device', strength: 'device' }
  }
  if (/^[A-Z][A-Z0-9-]{3,}$/i.test(text)) return { family: 'device', strength: 'generic' }
  return { family: 'unknown', strength: 'none' }
}

/** Prefixes a part with this pin count could plausibly carry. */
function familyPrefixesFor(pins) {
  if (pins <= 3) return new Set(['C', 'R', 'L', 'D', 'FB', 'F', 'T', 'X', 'Y', 'J'])
  if (pins <= 8) return new Set(['U', 'Q', 'IC', 'SW', 'VR', 'L', 'Y'])
  return new Set(['U', 'IC', 'Q', 'PU'])
}

function prefixOf(refdes) {
  const match = String(refdes ?? '').toUpperCase().match(/^([A-Z]+)\d/)
  return match ? match[1] : ''
}

/** Is this part one the boardview could not name? */
export function isPlaceholderRefdes(refdes) {
  const text = String(refdes ?? '').trim()
  return text.length === 0 || PLACEHOLDER_REFDES.test(text)
}

/**
 * Index the schematic pages once: where each refdes token sits, per page.
 *
 * @returns {{pages: {page: number, upper: string, tokens: {refdes: string, at: number}[]}[]}}
 */
function indexSchematic(schematic) {
  const pages = []
  for (const page of schematic?.pages ?? []) {
    const text = String(page.text ?? '')
    if (text.length === 0) continue
    const tokens = []
    REFDES_TOKEN.lastIndex = 0
    let match
    while ((match = REFDES_TOKEN.exec(text)) !== null) {
      tokens.push({ refdes: match[0].toUpperCase(), at: match.index })
    }
    if (tokens.length === 0) continue
    pages.push({ page: page.page, upper: text.toUpperCase(), tokens })
  }
  return pages
}

/** Refdes tokens within `window` characters of `at`, in document order. */
function tokensNear(page, at, window) {
  const found = []
  // Pages hold at most a few thousand labels; a linear scan is fine and avoids
  // maintaining a second sorted structure.
  for (const token of page.tokens) {
    if (token.at < at - window) continue
    if (token.at > at + window) break
    found.push(token.refdes)
  }
  return found
}

function occurrences(haystack, needle, limit) {
  const found = []
  let from = 0
  while (found.length < limit) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    found.push(at)
    from = at + needle.length
  }
  return found
}

/**
 * Propose names for the parts a boardview could not label.
 *
 * @param {object} board the stored board model
 * @param {object|null} schematic the extracted schematic text layer, or null
 * @param {object} [options]
 * @param {number} [options.window] characters of schematic text around a value (default 600)
 * @param {number} [options.maxOccurrences] occurrences examined per value (default 24)
 * @returns {{
 *   assignments: Map<number, object>,
 *   unnamedCount: number,
 *   namedFromSchematic: number,
 *   needsHuman: number,
 *   stats: object
 * }}
 */
export function planNaming(board, schematic, options = {}) {
  const window = Number.isFinite(options.window) ? options.window : 600
  const maxOccurrences = Number.isFinite(options.maxOccurrences) ? options.maxOccurrences : 24
  const assignments = new Map()
  const parts = board?.parts ?? []

  // Which parts need a name, grouped by the marking they carry.
  const unnamed = []
  const byValue = new Map()
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex]
    if (!isPlaceholderRefdes(part.refdes)) continue
    const value = String(part.value ?? '').trim()
    const classified = classifyValue(value)
    unnamed.push({ partIndex, value, classified, pins: Number(part.pins) || 0 })
    if (classified.strength !== 'none' && value.length >= 3) {
      const key = value.toUpperCase()
      let bucket = byValue.get(key)
      if (!bucket) {
        bucket = { value, classified, members: [] }
        byValue.set(key, bucket)
      }
      bucket.members.push({ partIndex, pins: Number(part.pins) || 0 })
    }
  }

  const pages = schematic ? indexSchematic(schematic) : []
  let named = 0
  let needsHuman = 0
  const valueStats = []

  for (const [key, bucket] of byValue) {
    // Where does this marking appear in the schematic at all?
    const hits = []
    for (const page of pages) {
      for (const at of occurrences(page.upper, key, maxOccurrences)) hits.push({ page, at })
      if (hits.length >= maxOccurrences) break
    }
    if (hits.length === 0) {
      valueStats.push({ value: bucket.value, hits: 0, candidates: 0 })
      continue
    }

    // Vote: which designators are printed near that marking?
    const votes = new Map()
    for (const hit of hits) {
      for (const refdes of tokensNear(hit.page, hit.at, window)) {
        votes.set(refdes, (votes.get(refdes) ?? 0) + 1)
      }
    }
    valueStats.push({ value: bucket.value, hits: hits.length, candidates: votes.size })

    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (ranked.length === 0) continue

    for (const member of bucket.members) {
      const allowed = familyPrefixesFor(member.pins)
      const compatible = ranked.filter(([refdes]) => allowed.has(prefixOf(refdes)))
      if (compatible.length === 0) continue

      const [bestRefdes, bestVotes] = compatible[0]
      const runnerUp = compatible[1]
      const unique = !runnerUp || bestVotes >= runnerUp[1] * 2
      const strong = bucket.classified.strength === 'device'

      const evidence = [
        `the schematic prints "${bucket.value}" next to ${bestRefdes}${bestVotes > 1 ? ` (${bestVotes} occurrences)` : ''}`,
      ]
      if (compatible.length > 1) {
        evidence.push(`${compatible.length} designators share that marking on their page`)
      }
      if (!strong) evidence.push('the marking is a generic value, so this is a suggestion rather than a match')

      if (unique && strong && bucket.members.length === 1) {
        assignments.set(member.partIndex, {
          alias: bestRefdes,
          source: 'schematic',
          confidence: 'high',
          evidence,
          candidates: compatible.slice(0, 5).map(([refdes, count]) => ({ refdes, votes: count })),
        })
        named += 1
      } else {
        assignments.set(member.partIndex, {
          alias: null,
          source: 'schematic',
          confidence: 'ambiguous',
          evidence,
          candidates: compatible.slice(0, 5).map(([refdes, count]) => ({ refdes, votes: count })),
        })
        needsHuman += 1
      }
    }
  }

  const unplaceable = unnamed.filter((entry) => !assignments.has(entry.partIndex)).length
  return {
    assignments,
    unnamedCount: unnamed.length,
    namedFromSchematic: named,
    needsHuman: needsHuman + unplaceable,
    stats: {
      unnamed: unnamed.length,
      distinctMarkings: byValue.size,
      schematicPages: pages.length,
      valuesSeenInSchematic: valueStats.filter((entry) => entry.hits > 0).length,
    },
  }
}

/**
 * A display label for a part: the alias when there is one, the raw label
 * otherwise. Callers must keep `refdes` for identity.
 */
export function displayRefdes(part, aliasEntry) {
  if (aliasEntry?.alias) return aliasEntry.alias
  return part?.refdes ?? '?'
}

/**
 * Decide which entries are really components.
 *
 * A boardview also ships pads and test points in its part table. On the PS5
 * export 3429 of the 5950 entries are a single pad with a generated label and
 * no marking — they are probe points, not parts, and counting them as
 * components makes the board look four times denser than it is and floods
 * every part list with entries nobody can order.
 *
 * The rule is deliberately narrow: a generated label with at most one pad is a
 * pad. Anything with two or more pads stays a component even when unnamed,
 * because a two-pad body is a part whether or not the file knows its name.
 *
 * @param {object[]} parts the board's part records (annotated in place)
 * @returns {{components: number, pads: number, unnamed: number}}
 */
export function classifyParts(parts) {
  let components = 0
  let pads = 0
  let unnamed = 0
  for (const part of parts ?? []) {
    const pins = Number(part.pins) || 0
    const placeholder = isPlaceholderRefdes(part.refdes)
    if (placeholder) unnamed += 1
    if (placeholder && pins <= 1) {
      part.role = 'pad'
      pads += 1
    } else {
      part.role = 'component'
      components += 1
    }
  }
  return { components, pads, unnamed }
}
