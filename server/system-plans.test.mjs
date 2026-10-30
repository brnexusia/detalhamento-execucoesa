import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { systemPlans } from './system-plans.mjs'

test('Planos aprovados: preços, equipe, produtos e catálogos', () => {
  assert.deepEqual(systemPlans.map(p => p.code), ['bronze', 'prata', 'ouro'])
  const [bronze, prata, ouro] = systemPlans
  assert.deepEqual([bronze.monthlyPrice, bronze.sellerLimit, bronze.productLimit, bronze.catalogLimit, bronze.photoLimit],
    [49.90, 5, 500, 1, 5])
  assert.deepEqual([prata.monthlyPrice, prata.sellerLimit, prata.productLimit, prata.catalogLimit, prata.photoLimit],
    [94.90, 15, 2000, 3, 10])
  assert.deepEqual([ouro.monthlyPrice, ouro.sellerLimit, ouro.productLimit, ouro.catalogLimit, ouro.photoLimit],
    [144.90, null, null, null, null])
  for (const plan of systemPlans) {
    assert.equal(plan.semesterDiscount, 5)
    assert.equal(plan.annualDiscount, 15)
    assert.equal(plan.features.whatsappOrder, true)
    assert.equal(plan.features.vaxLar, false)
  }
})

test('Migração de planos do sistema é versionada e não exclui dados de lojas', () => {
  for (const path of ['server/platform-hooks.mjs', 'server/plan-limits-hooks.mjs']) {
    const content = readFileSync(path, 'utf8')
    assert.match(content, /mvp_schema_version<3/, path)
    assert.match(content, /SHOPVAX_APPLY_APPROVED_PLAN_LIMITS === '1'/, 'Migração de contas existentes exige opt-in')
    assert.match(content, /platform_plans\.is_system=true/, path)
    assert.doesNotMatch(content, /DELETE FROM (products|sellers|stores)\b/i, 'Migração não pode apagar produtos/lojas')
  }
})
