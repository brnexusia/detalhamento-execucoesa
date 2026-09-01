import fs from 'node:fs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const feedSource = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Afinidade', email: `affinity-${unique}@example.com`, password: 'senha-social-123', storeName: `Afinidade ${unique}`, whatsapp: '5511988888888' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie }
}

async function seller(owner, name, phone) {
  const response = await fetch(`${base}/api/admin/sellers`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ name, phone, isActive: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Vendedora: ${response.status} ${JSON.stringify(body)}`)
  return body.seller
}

async function route(storeSlug, cookie = '') {
  const response = await fetch(`${base}/api/social/stores/${storeSlug}/seller-route`, { headers: cookie ? { cookie } : {} })
  const body = await response.json().catch(() => ({}))
  const setCookie = response.headers.get('set-cookie')?.split(';')[0] || cookie
  if (!response.ok) throw new Error(`Rota comercial: ${response.status} ${JSON.stringify(body)}`)
  return { body, cookie: setCookie }
}

const owner = await register()
const ana = await seller(owner, 'Ana', '5511991111111')
const bia = await seller(owner, 'Bia', '5511992222222')

const first = await route(owner.storeSlug)
const repeat = await route(owner.storeSlug, first.cookie)
if (!first.body.seller?.id || first.body.seller.id !== repeat.body.seller?.id) throw new Error('Afinidade da vendedora não persistiu ao entrar na loja.')
if (![ana.id, bia.id].includes(first.body.seller.id)) throw new Error('Rota da loja não resolveu vendedora ativa.')
const secondVisitor = await route(owner.storeSlug)
if (!secondVisitor.body.seller?.id || secondVisitor.body.seller.id === first.body.seller.id) throw new Error('Novos compradores não foram balanceados entre vendedoras.')
if (!feedSource.includes('/seller-route') || !feedSource.includes('storePath(slug, productId, sellerSlug)')) throw new Error('Feed não preserva a vendedora na navegação para a loja.')

console.log('social module 13 ok')
