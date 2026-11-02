import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(file, 'utf8')

test('admin exposes a separate buyer directory protected by platform admin session', () => {
  const app = read('src/PlatformAdmin.tsx')
  const view = read('src/PlatformBuyerDirectory.tsx')
  const router = read('server/platform-hooks.mjs')
  const api = read('server/platform-buyer-directory.mjs')
  assert.match(app, /section === 'compradores'/)
  assert.match(app, /label="Compradores"/)
  assert.match(router, /registerPlatformBuyerDirectory\(router, requirePlatformAdmin, asyncRoute, pool\)/)
  assert.match(api, /router.get\('\/buyers', requireAdmin/)
  assert.match(api, /router.get\('\/buyers\/:source\/:buyerId', requireAdmin/)
  assert.match(api, /Cache-Control', 'private, no-store'/)
  assert.match(view, /api\/platform\/buyers/)
})

test('buyer history is linked by verified IDs, not guessed by phone or email', () => {
  const api = read('server/platform-buyer-directory.mjs')
  assert.match(api, /c\.buyer_account_id=/)
  assert.match(api, /c\.id=/)
  assert.match(api, /o\.customer_id=c\.id|c\.id=o\.customer_id/)
  assert.match(api, /o\.store_id=c\.store_id|c\.store_id=o\.store_id/)
  assert.match(api, /c\.buyer_account_id IS NULL/)
  assert.match(api, /o\.status<>'cancelled'/)
  assert.match(api, /last_30_days/)
  assert.match(api, /last_90_days/)
  assert.match(api, /count\(DISTINCT c\.store_id\)/)
  assert.doesNotMatch(api, /JOIN buyer_accounts b ON b\.phone=c\.phone|JOIN buyer_accounts b ON b\.email=c\.email/)
})

test('buyer UI marks order totals as intent, keeps legacy and global profiles distinct', () => {
  const view = read('src/PlatformBuyerDirectory.tsx')
  assert.match(view, /Cadastro global WhatsApp/)
  assert.match(view, /Cadastro antigo por conta/)
  assert.match(view, /não é faturamento/)
  assert.match(view, /Somente vínculos|pedidos com cadastro efetivamente vinculado/i)
  assert.match(view, /Intervalo médio/)
  assert.match(view, /Promoções gerais/)
})
