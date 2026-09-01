import fs from 'node:fs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

const unauthorized = await fetch(`${base}/api/admin/social-metrics?days=30`)
if (unauthorized.status !== 401) throw new Error(`Métricas sociais deveriam exigir sessão: ${unauthorized.status}`)

const register = await fetch(`${base}/api/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Métricas', email: `metricas-${unique}@example.com`, password: 'senha-social-123', storeName: `Métricas ${unique}`, whatsapp: '5511988800000' }),
})
const owner = await register.json().catch(() => ({}))
const ownerCookie = register.headers.get('set-cookie')?.split(';')[0] || ''
if (!register.ok || !ownerCookie) throw new Error(`Loja de métricas não criada: ${register.status} ${JSON.stringify(owner)}`)

const sellerResponse = await fetch(`${base}/api/admin/sellers`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
  body: JSON.stringify({ name: 'Vendedora Métricas', phone: '5511991111111', isActive: true }),
})
const sellerBody = await sellerResponse.json().catch(() => ({}))
if (!sellerResponse.ok) throw new Error(`Vendedora não criada: ${sellerResponse.status} ${JSON.stringify(sellerBody)}`)

const productResponse = await fetch(`${base}/api/admin/products`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
  body: JSON.stringify({ name: `Produto Métricas ${unique}`, sku: `MET-${unique.slice(-6)}`, price: 89.9, category: 'Social', mediaUrl: 'https://example.invalid/metricas.jpg', mediaType: 'image', active: true }),
})
const productBody = await productResponse.json().catch(() => ({}))
if (!productResponse.ok) throw new Error(`Produto não criado: ${productResponse.status} ${JSON.stringify(productBody)}`)
const product = productBody.product

const profileResponse = await fetch(`${base}/api/social/stores/${owner.storeSlug}`)
const profile = await profileResponse.json().catch(() => ({}))
const visitorCookie = profileResponse.headers.get('set-cookie')?.split(';')[0] || ''
if (!profileResponse.ok || !visitorCookie || !profile.store?.id) throw new Error('Visitante social não foi criado para o teste de métricas.')
const storeId = profile.store.id

async function action(path) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: visitorCookie } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

await action(`/api/social/posts/${product.id}/view`)
await action(`/api/social/posts/${product.id}/view`)
await action(`/api/social/posts/${product.id}/like`)
await action(`/api/social/posts/${product.id}/share`)
const ask = await action(`/api/social/posts/${product.id}/ask`)
await action(`/api/social/stores/${storeId}/follow`)
if (ask.seller?.id !== sellerBody.seller.id) throw new Error('Pergunta social não foi atribuída à vendedora esperada.')

const reportResponse = await fetch(`${base}/api/admin/social-metrics?days=30`, { headers: { cookie: ownerCookie } })
const report = await reportResponse.json().catch(() => ({}))
if (!reportResponse.ok) throw new Error(`Relatório social falhou: ${reportResponse.status} ${JSON.stringify(report)}`)

const summary = report.summary || {}
if (summary.productViews !== 1) throw new Error(`Views sociais deveriam deduplicar o visitante: ${JSON.stringify(summary)}`)
if (summary.likes !== 1 || summary.shares !== 1 || summary.asks !== 1 || summary.followers !== 1 || summary.newFollowers !== 1) {
  throw new Error(`Resumo social inválido: ${JSON.stringify(summary)}`)
}
if (summary.reach !== 1 || summary.engagedVisitors !== 1 || summary.interactionRate !== 100 || summary.askRate !== 100) {
  throw new Error(`Taxas sociais inválidas: ${JSON.stringify(summary)}`)
}

const item = report.products?.find((entry) => entry.id === product.id)
if (!item || item.views !== 1 || item.likes !== 1 || item.shares !== 1 || item.asks !== 1 || item.askRate !== 100) {
  throw new Error(`Ranking social do produto inválido: ${JSON.stringify(item)}`)
}
const seller = report.sellers?.find((entry) => entry.sellerId === sellerBody.seller.id)
if (!seller || seller.asks !== 1) throw new Error(`Métrica social por vendedora inválida: ${JSON.stringify(report.sellers)}`)
if (!String(report.interpretation || '').toLowerCase().includes('não representam venda')) throw new Error('Relatório social não preserva a regra de intenção versus venda confirmada.')

const panelSource = fs.readFileSync(new URL('../src/AnalyticsPanel.tsx', import.meta.url), 'utf8')
if (!panelSource.includes('Rede Shopvax') || !panelSource.includes('/api/admin/social-metrics') || !panelSource.includes('Perguntas')) {
  throw new Error('Painel administrativo não expõe as métricas da rede Shopvax.')
}

console.log('social module 10 ok')
