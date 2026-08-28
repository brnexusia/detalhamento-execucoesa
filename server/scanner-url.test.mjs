import assert from 'node:assert/strict'
import { normalizeImportUrl } from './scanner-hooks.mjs'

assert.deepEqual(normalizeImportUrl('minhaloja.com.br'), {
  url: 'https://minhaloja.com.br/',
  host: 'minhaloja.com.br',
})
assert.deepEqual(normalizeImportUrl('https://MinhaLoja.com.br/catalogo?utm_source=x#produto'), {
  url: 'https://minhaloja.com.br/catalogo',
  host: 'minhaloja.com.br',
})
assert.deepEqual(normalizeImportUrl('http://example.com'), {
  url: 'http://example.com/',
  host: 'example.com',
})

for (const value of [
  '',
  'ftp://example.com',
  'http://localhost',
  'http://127.0.0.1',
  'http://10.0.0.2',
  'http://172.16.2.2',
  'http://192.168.1.2',
  'http://169.254.1.1',
  'http://[::1]',
  'http://site.local',
  'https://user:pass@example.com',
  'https://example.com:8080',
]) {
  assert.throws(() => normalizeImportUrl(value), Error, `deveria bloquear ${value}`)
}

console.log('[scanner module 1] URL validation: ok')
