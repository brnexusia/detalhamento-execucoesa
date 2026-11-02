import assert from 'node:assert/strict'
import { inferPdfProductCategory } from './scanner-pdf-category.mjs'

for (const [name, expected] of [
  ['Calça Milano', 'Calças'],
  ['Blusa Dominique', 'Blusas'],
  ['Conjunto Noelle Cherry', 'Conjuntos'],
  ['Corset Cloé', 'Corsets'],
  ['Regta Lumi', 'Regatas'],
  ['Shorts Eva', 'Shorts'],
  ['Camisa Charlotte', 'Camisas'],
  ['Saia Midi', 'Saias'],
  ['Peça sem descrição', 'Outros'],
]) {
  assert.equal(inferPdfProductCategory(name), expected, name)
}
console.log('[scanner pdf categories] inference: ok')
