import test from 'node:test'
import assert from 'node:assert/strict'
import { requireCompleteCatalog } from './scanner-import-completeness.mjs'

test('completed structured imports are accepted for review', () => {
  assert.doesNotThrow(() => requireCompleteCatalog({ platform: 'gopage', complete: true, candidateCount: 293 }))
})
test('legacy generic importers keep their existing behavior', () => {
  assert.doesNotThrow(() => requireCompleteCatalog({ platform: 'generic', candidateCount: 12 }))
})
test('incomplete structured catalog raises an actionable and non-sensitive error', () => {
  assert.throws(
    () => requireCompleteCatalog({
      platform: 'gopage', complete: false,
      warnings: ['A página 3 foi interrompida', 'Faltam 20 produtos'],
    }),
    /captura do catálogo foi parcial.*página 3.*Faltam 20 produtos/
  )
})
