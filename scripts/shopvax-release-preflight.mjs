#!/usr/bin/env node
/**
 * ShopVax Frente 01 — verificador estático, somente leitura e sem acesso a segredos.
 * Este script NÃO acessa EasyPanel, banco, domínio nem prova homologação externa.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { systemPlans } from '../server/system-plans.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

export function auditContract({ plans, phase5Source, appSource, dockerSource, hasLockfile, workflowSource }) {
  const findings = []
  const add = (id, severity, message) => findings.push({ id, severity, message })
  const expected = [
    { code: 'bronze', price: 49.9, sellers: 5, products: 500, catalogs: 1, photos: 5 },
    { code: 'prata', price: 94.9, sellers: 15, products: 2000, catalogs: 3, photos: 10 },
    { code: 'ouro', price: 144.9, sellers: null, products: null, catalogs: null, photos: null },
  ]
  for (const target of expected) {
    const plan = plans.find(item => item.code === target.code)
    if (!plan) {
      add('PLAN_MISSING_' + target.code, 'blocker', 'Plano aprovado ausente: ' + target.code)
      continue
    }
    const mismatches = [
      ['monthlyPrice', target.price],
      ['sellerLimit', target.sellers],
      ['productLimit', target.products],
      ['catalogLimit', target.catalogs],
      ['photoLimit', target.photos],
    ].filter(([key, value]) => plan[key] !== value).map(([key]) => key)
    if (mismatches.length) add('PLAN_CONTRACT_' + target.code, 'blocker',
      'Contrato estático divergente em ' + target.code + ': ' + mismatches.join(', '))
    if (plan.semesterDiscount !== 5 || plan.annualDiscount !== 15) {
      add('PLAN_DISCOUNTS_' + target.code, 'blocker', 'Descontos de ciclo divergentes: ' + target.code)
    }
  }
  if (/if\s*\(\s*code\s*===\s*['"]ouro['"]\s*\)\s*return\s*\{[^}]*photosPerProduct:\s*10\b/.test(phase5Source)) {
    add('OURO_DISPLAY_PHOTO_LIMIT', 'blocker',
      'Resumo de uso da fase 5 exibe 10 fotos no Ouro, mas contrato aprovado é ilimitado.')
  }
  if (!/SHOPVAX_RELEASE_SHA/.test(appSource) || !/app\.get\(['"]\/health['"]/.test(appSource)) {
    add('HEALTH_RELEASE_SHA', 'blocker', 'Endpoint /health sem evidência de release SHA.')
  }
  if (!/SHOPVAX_EXPECTED_SHA/.test(workflowSource) || !/verify-production\.mjs/.test(workflowSource)) {
    add('MANUAL_PRODUCTION_READINESS', 'blocker', 'Workflow manual de smoke/versão ausente.')
  }
  if (!/HEALTHCHECK/.test(dockerSource) || !/EXPOSE 80/.test(dockerSource)) {
    add('DOCKER_HEALTHCHECK', 'blocker', 'Dockerfile sem porta 80 ou healthcheck.')
  }
  if (!hasLockfile) {
    add('NO_LOCKFILE', 'warning', 'Sem package-lock.json: builds podem resolver novas versões de dependências.')
  }
  if (/\bnpm install\b/.test(dockerSource)) {
    add('NONDETERMINISTIC_INSTALL', 'warning', 'Dockerfile usa npm install; após lockfile preferir npm ci.')
  }
  return {
    scope: 'static_source_only',
    externallyVerified: false,
    inspected: ['server/system-plans.mjs', 'server/phase5-launch-hooks.mjs', 'server/app.mjs',
      'Dockerfile', 'package-lock.json', '.github/workflows/production-readiness.yml'],
    findings,
    staticContractApproved: !findings.some(item => item.severity === 'blocker'),
    productionGo: false,
    next: 'Inspecionar EasyPanel/DB/volumes, provar backup+restore, SHA/digest, duas lojas e aparelhos físicos; ver issue #75.',
  }
}

export function inspectRepository() {
  return auditContract({
    plans: systemPlans,
    phase5Source: read('server/phase5-launch-hooks.mjs'),
    appSource: read('server/app.mjs'),
    dockerSource: read('Dockerfile'),
    hasLockfile: existsSync(resolve(root, 'package-lock.json')),
    workflowSource: read('.github/workflows/production-readiness.yml'),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = inspectRepository()
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (process.argv.includes('--strict') && !result.staticContractApproved) process.exitCode = 1
}
