#!/usr/bin/env node
/**
 * Load a boardview (and optionally its schematic PDF) into the WrenchBench
 * library from the command line.
 *
 * This is the same path the sidebar panel and the `wrenchbench_import` tool
 * take; it exists so a board can be loaded without a browser, and so a newly
 * supported format can be exercised before the Host reloads the plugin.
 *
 * Usage:
 *   node scripts/load-board.mjs <boardview-file> [schematic.pdf] [display name]
 *   node scripts/load-board.mjs <boardview-file> --name "PS5 EDM-010" [--pdf schematic.pdf]
 *
 * Examples:
 *   node scripts/load-board.mjs "C:\Downloads\board.pcb" "C:\Downloads\schematic.pdf" "PS5 EDM-010"
 *   node scripts/load-board.mjs ./b450m.tvw --name "Gigabyte B450M DS3H V2"
 */
import fs from 'node:fs'
import path from 'node:path'

import { parseBoard, BoardParseError } from '../parsers.js'
import { extractPdfText } from '../pdf-text.js'
import * as store from '../store.js'

const rawArguments = process.argv.slice(2)
const flags = {}
const positional = []
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index]
  if (argument === '--name' || argument === '--pdf') {
    flags[argument.slice(2)] = rawArguments[(index += 1)]
  } else if (argument.startsWith('--name=')) {
    flags.name = argument.slice('--name='.length)
  } else if (argument.startsWith('--pdf=')) {
    flags.pdf = argument.slice('--pdf='.length)
  } else if (argument.length > 0) {
    positional.push(argument)
  }
}

const boardArgument = positional[0]
const pdfArgument = flags.pdf ?? positional[1]
const nameArgument = flags.name ?? positional[2]

if (!boardArgument) {
  console.error('usage: node scripts/load-board.mjs <boardview-file> [schematic.pdf] [display name]')
  process.exit(2)
}

function describe(error) {
  if (error instanceof BoardParseError) {
    return `${error.message}${error.hint ? `\n  hint: ${error.hint}` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}

let boardBytes
try {
  boardBytes = fs.readFileSync(path.resolve(boardArgument))
} catch (error) {
  console.error(`cannot read ${boardArgument}: ${describe(error)}`)
  process.exit(1)
}

let parsed
try {
  parsed = parseBoard(boardBytes, path.basename(boardArgument))
} catch (error) {
  console.error(`could not parse ${path.basename(boardArgument)}: ${describe(error)}`)
  process.exit(1)
}

const id = store.boardIdFor(boardBytes, path.basename(boardArgument))
const displayName = nameArgument ?? path.basename(boardArgument).replace(/\.[^.]+$/, '')

const meta = store.saveBoard({
  id,
  name: displayName,
  sourceName: path.basename(boardArgument),
  format: parsed.format,
  units: parsed.units,
  board: parsed,
  warnings: parsed.warnings,
})

console.log(`board    ${meta.name} [${meta.id}]`)
console.log(`format   ${meta.format} (${meta.units === 'mm' ? 'millimetres' : 'board units'})`)
console.log(`contents ${meta.stats.parts} components, ${meta.stats.pins} pads, ${meta.stats.nets} nets`)
if (meta.warnings.length > 0) {
  for (const warning of meta.warnings) console.log(`warning  ${warning}`)
}

if (pdfArgument) {
  let pdfBytes
  try {
    pdfBytes = fs.readFileSync(path.resolve(pdfArgument))
  } catch (error) {
    console.error(`cannot read ${pdfArgument}: ${describe(error)}`)
    process.exit(1)
  }
  try {
    const extracted = extractPdfText(pdfBytes, path.basename(pdfArgument))
    const record = store.saveSchematic(id, extracted)
    console.log(`schematic ${record.name} — ${record.stats.pages} pages, ${record.stats.chars} characters`)
    for (const warning of record.warnings) console.log(`warning  ${warning}`)
  } catch (error) {
    console.error(`could not read the schematic: ${describe(error)}`)
    process.exit(1)
  }
}

console.log(`library  ${store.dataRoot}`)
