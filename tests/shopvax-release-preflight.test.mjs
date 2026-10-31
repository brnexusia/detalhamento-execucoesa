import test from 'node:test'
import assert from 'node:assert/strict'
import { auditContract, inspectRepository } from '../scripts/shopvax-release-preflight.mjs'
import { systemPlans } from '../server/system-plans.mjs'

const fixture = () => ({
  plans: structuredClone(systemPlans),
  phase5Source: "function planExtraLimits(code) { if (code === 'ouro') return { photosPerProduct: null, franchisees: null } }",
  appSource: "app.get('/health', () => process.env.SHOPVAX_RELEASE_SHA)",
  dockerSource: 'EXPOSE 80\nHEALTHCHECK CMD node health.js\nRUN npm ci',
  hasLockfile: true,
  workflowSource: 'SHOPVAX_EXPECTED_SHA: input\nnode scripts/verify-production.mjs',
})

test('contratos coerentes passam estaticamente, mas nunca afirmam GO de producao', () => {
  const result = auditContract(fixture())
  assert.equal(result.staticContractApproved, true)
  assert.equal(result.productionGo, false)
  assert.equal(result.externallyVerified, false)
  assert.deepEqual(result.findings, [])
})

test('detecta o limite equivocado de fotos do Ouro, lockfile ausente e npm install', () => {
  const f = fixture()
  f.phase5Source = "if (code === 'ouro') return { photosPerProduct: 10, franchisees: null }"
  f.dockerSource = 'EXPOSE 80\nHEALTHCHECK CMD node health.js\nRUN npm install'
  f.hasLockfile = false
  const ids = auditContract(f).findings.map(item => item.id)
  assert(ids.includes('OURO_DISPLAY_PHOTO_LIMIT'))
  assert(ids.includes('NO_LOCKFILE'))
  assert(ids.includes('NONDETERMINISTIC_INSTALL'))
})

test('rejeita alteracoes nao aprovadas de preco, limites e descontos', () => {
  const f = fixture()
  f.plans[0].monthlyPrice = 69
  f.plans[1].sellerLimit = 50
  f.plans[2].photoLimit = 10
  f.plans[2].annualDiscount = 10
  const findings = auditContract(f).findings
  assert.equal(findings.filter(item => item.id.startsWith('PLAN_CONTRACT_')).length, 3)
  assert(findings.some(item => item.id === 'PLAN_DISCOUNTS_ouro'))
})

test('exige health SHA, Docker healthcheck e workflow publico', () => {
  const f = fixture()
  f.appSource = "app.get('/health', () => true)"
  f.dockerSource = 'EXPOSE 80'
  f.workflowSource = ''
  const ids = auditContract(f).findings.map(item => item.id)
  for (const id of ['HEALTH_RELEASE_SHA','DOCKER_HEALTHCHECK','MANUAL_PRODUCTION_READINESS']) assert(ids.includes(id))
})

test('inspecao real da arvore gera evidencias sem ler variaveis de ambiente nem conectar a producao', () => {
  const result = inspectRepository()
  assert.equal(result.scope, 'static_source_only')
  assert.equal(result.productionGo, false)
  assert(Array.isArray(result.findings))
  assert.equal(result.inspected.length, 6)
})
