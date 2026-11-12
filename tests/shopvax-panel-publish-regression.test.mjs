import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('scanner publisher passes all six SQL bind arguments including destination catalog', () => {
  const source = readFileSync(new URL('../server/scanner-publish-hooks.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('const updated = await client.query(\n      `UPDATE import_jobs')
  assert(start > 0, 'final import_jobs UPDATE was not found')
  const block = source.slice(start, start + 550)
  const statement = block.match(/`(UPDATE import_jobs[\s\S]*?RETURNING \*)`/)
  assert(statement, 'query text missing')
  const placeholders = [...statement[1].matchAll(/\$(\d+)/g)].map(item => Number(item[1]))
  assert.equal(Math.max(...placeholders), 6)
  assert.deepEqual(new Set(placeholders), new Set([1,2,3,4,5,6]))
  const params = block.match(/\[(created,\s*skippedExisting,\s*mode,\s*job\.id,\s*store\.store_id,\s*targetCatalogId)\]/)
  assert(params, 'final SQL bind must pass destination catalogId as sixth argument')
})

test('admin route never renders empty screen while checking billing', () => {
  const source = readFileSync(new URL('../src/AdminRoute.tsx', import.meta.url), 'utf8')
  assert(!/billingGate === ['"]checking['"]\) return null/.test(source))
  assert(source.includes('Verificando acesso ao painel'))
  assert(source.includes('ShopvaxLoading'))
})

test('app catches failed lazy chunks and provides user-controlled recovery', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const boundary = readFileSync(new URL('../src/AppRuntimeBoundary.tsx', import.meta.url), 'utf8')
  assert(app.includes('<AppRuntimeBoundary'))
  assert(boundary.includes('getDerivedStateFromError'))
  assert(boundary.includes('window.location.reload()'))
})
