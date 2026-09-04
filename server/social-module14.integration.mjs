import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/PublicStoreV2.tsx', import.meta.url), 'utf8')
if (!source.includes('`shopvax-cart-v1:${encodeURIComponent(route.storeSlug)}`')) throw new Error('Carrinho não está isolado pelo slug da loja.')
if (!source.includes('localStorage.getItem(cartStorageKey)') || !source.includes('localStorage.setItem(cartStorageKey')) throw new Error('Leitura/escrita do carrinho não usa a chave isolada da loja.')
if (source.includes("localStorage.getItem('atacado-shop-cart-v3')") || source.includes("localStorage.setItem('atacado-shop-cart-v3'")) throw new Error('Carrinho global antigo ainda está ativo.')

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: label, email: `${label}-${unique}@example.com`, password: 'senha-social-123', storeName: `${label} ${unique}`, whatsapp: '5511999999999' }) })
  const body = await response.json().catch(() => ({})); const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${label}: ${response.status}`)
  return { ...body, cookie }
}
async function product(owner) {
  const response = await fetch(`${base}/api/admin/products`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie }, body: JSON.stringify({ name: `Produto ${unique}`, price: 999, category: 'Teste', mediaUrl: 'https://example.invalid/cart.jpg', mediaType: 'image', active: true }) })
  const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`Produto: ${response.status}`); return body.product
}
const a = await register('CartA'); const b = await register('CartB'); const itemA = await product(a)
const cross = await fetch(`${base}/api/business/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeSlug: b.storeSlug, items: [{ productId: itemA.id, quantity: 1, selections: {} }] }) })
if (cross.ok) throw new Error('Backend aceitou produto de outra loja no pedido.')

console.log('social module 14 ok')
