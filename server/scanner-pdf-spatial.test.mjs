import test from 'node:test'
import assert from 'node:assert/strict'
import { associateOcrProducts, parseBrazilianPrice } from './scanner-pdf-spatial.mjs'

function ocr(...lines) {
  return { text: lines.map((line) => line.text).join('\n'), lines }
}

function box(text, x, y, width = 190, height = 25, score = 0.97) {
  return { text, box: [x, y, x + width, y + height], score }
}

test('parses BRL strings into numeric floats without losing cents', () => {
  assert.equal(parseBrazilianPrice('R$ 12,50'), 12.5)
  assert.equal(parseBrazilianPrice('R$1.234,56'), 1234.56)
  assert.equal(parseBrazilianPrice('Preço: R$ 39,90'), 39.9)
  assert.equal(parseBrazilianPrice('Valor: 75,00'), 75)
  assert.equal(parseBrazilianPrice(' 12,50 '), 12.5)
  assert.equal(parseBrazilianPrice('R$ 1300'), null)
  assert.equal(parseBrazilianPrice('R$ 12,0'), null)
  assert.equal(parseBrazilianPrice('R$ 1.234,567'), null)
  assert.equal(parseBrazilianPrice('R$ 12,50 e R$ 19,90'), null)
  assert.equal(parseBrazilianPrice('TOTAL: R$ 30,46'), null)
})

test('matches descriptions and prices by geometry even with shuffled reading order', () => {
  const found = associateOcrProducts(ocr(
    box('R$ 70,00', 840, 195, 160),
    box('Blusa Florença', 50, 105, 220),
    box('Descrição: crepe macio', 50, 152, 225),
    box('R$ 45,00', 55, 195, 155),
    box('Calça Milano', 805, 105, 225),
    box('Descrição: cetim premium', 805, 152, 230),
  ), 7)
  assert.equal(found.length, 2)
  assert.deepEqual(found.map((item) => [item.title, item.price]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['Blusa Florença', 45],
    ['Calça Milano', 70],
  ])
  assert.match(found.find((item) => item.title === 'Blusa Florença').description, /crepe macio/)
  assert.doesNotMatch(found.find((item) => item.title === 'Blusa Florença').description, /cetim premium/)
  assert.match(found.find((item) => item.title === 'Calça Milano').description, /cetim premium/)
  assert.ok(found.every((item) => item.pdf_review_required === true))
  assert.ok(found.every((item) => /REVISÃO OBRIGATÓRIA/.test(item.description)))
})

test('accepts a supplier-labelled product title next to a price on the same line', () => {
  const found = associateOcrProducts(ocr(
    box('Produto: Conjunto Noelle R$ 89,90', 80, 100, 540),
  ), 2)
  assert.equal(found.length, 1)
  assert.equal(found[0].title, 'Conjunto Noelle')
  assert.equal(found[0].price, 89.9)
})

test('does not create products from generic descriptions or freight totals', () => {
  const found = associateOcrProducts(ocr(
    box('Descrição: ótimo acabamento e tecidos macios', 50, 100, 550),
    box('TOTAL: R$ 130,00', 50, 160, 240),
    box('Frete R$ 15,00', 50, 210, 220),
  ), 3)
  assert.deepEqual(found, [])
})

test('rejects incomplete OCR monetary values without borrowing digits from neighbors', () => {
  const found = associateOcrProducts(ocr(
    box('Vestido Aurora', 30, 80),
    box('R$ 1300', 30, 140),
    box('R$ 12,0', 30, 190),
  ), 9)
  assert.equal(found.length, 0)
})

test('never guesses a missing product name or geometry', () => {
  assert.deepEqual(associateOcrProducts(ocr(box('R$ 12,50', 30, 90)), 5), [])
  assert.deepEqual(associateOcrProducts({ text: 'Vestido Solar\nR$ 29,90', lines: [] }, 5), [])
  assert.deepEqual(associateOcrProducts({ lines: [
    { text: 'Vestido Solar', box: null },
    box('R$ 29,90', 30, 130),
  ] }, 5), [])
})

test('does not match prices across distant unrelated columns', () => {
  const found = associateOcrProducts(ocr(
    box('Vestido Solar', 30, 110, 190),
    box('R$ 59,00', 1150, 145, 130),
  ), 4)
  assert.equal(found.length, 0)
})

test('does not turn multiple prices on the same line into a single invented price', () => {
  const found = associateOcrProducts(ocr(
    box('Calça Milano', 40, 90, 220),
    box('Atacado R$ 40,00 / Varejo R$ 70,00', 40, 150, 430),
  ), 5)
  assert.equal(found.length, 0)
})

test('ignores low confidence text boxes and invalid coordinates', () => {
  const found = associateOcrProducts(ocr(
    box('Vestido Solar', 30, 90, 200, 25, 0.2),
    box('R$ 29,90', 30, 140, 150),
    { text: 'Produto: Blusa Lua', score: 0.9, box: [10, 40, 20] },
  ), 4)
  assert.deepEqual(found, [])
})
