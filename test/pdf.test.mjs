/**
 * PDF text-layer tests.
 *
 * The bug this guards is specific: a schematic PDF stores *glyph codes*, not
 * characters. Reading a content stream as latin1 produces mojibake that looks
 * like text to a naive indexer and is then cited by the agent as if it were a
 * real label. So the fixture below is a PDF whose `Tj` operand is `\x01\x02\x03`
 * and whose only route back to readable text is a `/ToUnicode` CMap.
 *
 * Run with `node test/pdf.test.mjs`.
 */
import assert from 'node:assert/strict'
import { extractPdfPages, parseToUnicode } from '../pdf-objects.js'
import { extractPdfText } from '../pdf-text.js'

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

/** Build a one-page PDF whose text needs the given ToUnicode CMap. */
function buildPdf({ content, cmap }) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }

  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  add(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  )
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAA+Subset /ToUnicode 6 0 R >>')
  add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`)

  let out = '%PDF-1.4\n'
  objects.forEach((body, index) => {
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  out += 'trailer\n<< /Size 7 /Root 1 0 R >>\n%%EOF\n'
  return Buffer.from(out, 'latin1')
}

const CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<00> <ff>
endcodespacerange
3 beginbfchar
<01> <0052>
<02> <0030>
<03> <0034>
endbfchar
endcmap
end
end`

console.log('\ncmap parsing')
check('maps a single code to one character', () => {
  const parsed = parseToUnicode(CMAP)
  assert.equal(parsed.width, 1)
  assert.equal(parsed.map.get(1), 'R')
  assert.equal(parsed.map.get(2), '0')
  assert.equal(parsed.map.get(3), '4')
})

check('reads the code width from the codespace range', () => {
  const twoByte = CMAP.replace('<00> <ff>', '<0000> <ffff>')
  assert.equal(parseToUnicode(twoByte).width, 2)
})

check('expands a bfrange', () => {
  const ranged = CMAP.replace(
    /3 beginbfchar[\s\S]*?endbfchar/,
    '1 beginbfrange\n<01> <03> <0041>\nendbfrange',
  )
  const parsed = parseToUnicode(ranged)
  assert.equal(parsed.map.get(1), 'A')
  assert.equal(parsed.map.get(3), 'C')
})

console.log('\ntext extraction')
check('decodes glyph codes through the font ToUnicode map', () => {
  const pdf = buildPdf({
    content: 'BT /F1 12 Tf 40 700 Td (\\001\\002\\003) Tj ET',
    cmap: CMAP,
  })
  const result = extractPdfPages(pdf)
  assert.equal(result.pageCount, 1)
  assert.match(result.pages[0].text, /R04/)
})

check('keeps page order and per-page text separate', () => {
  const pdf = buildPdf({
    content: 'BT /F1 12 Tf 40 700 Td (\\001\\002) Tj ET',
    cmap: CMAP,
  })
  const pages = extractPdfPages(pdf).pages
  assert.equal(pages.length, 1)
  assert.equal(pages[0].page, 1)
  assert.ok(pages[0].text.length > 0)
})

check('a page of binary drivel is left empty, not indexed', () => {
  const binaryCmap = CMAP.replace(/3 beginbfchar[\s\S]*?endbfchar/, '1 beginbfrange\n<00> <ff> <0000>\nendbfrange')
  const pdf = buildPdf({
    content: `BT /F1 12 Tf 40 700 Td (${'\\001'.repeat(200)}) Tj ET`,
    cmap: binaryCmap,
  })
  const result = extractPdfPages(pdf)
  assert.equal(result.pages[0].text, '')
  assert.ok(result.warnings.some((warning) => /non-text output/.test(warning)))
})

check('the public extractor reports a real page count and text', () => {
  const pdf = buildPdf({
    content: 'BT /F1 12 Tf 40 700 Td (\\001\\002\\003) Tj ET',
    cmap: CMAP,
  })
  const schematic = extractPdfText(pdf, 'fixture.pdf')
  assert.equal(schematic.stats.pages, 1)
  assert.ok(schematic.stats.chars > 0)
  assert.equal(schematic.pageNumbering, 'page-tree')
})

check('a non-PDF is refused', () => {
  assert.throws(() => extractPdfText(Buffer.from('not a pdf at all'), 'x.pdf'), /PDF header/)
})

console.log(failures.length === 0 ? `\nPDF CHECKS PASS (${passed})` : `\n${failures.length} PDF CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
