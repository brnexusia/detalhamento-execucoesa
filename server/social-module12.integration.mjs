import fs from 'node:fs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const feedSource = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const storeSource = fs.readFileSync(new URL('../src/PublicStoreV2.tsx', import.meta.url), 'utf8')

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Deep Link', email: `deep-${unique}@example.com`, password: 'senha-social-123', storeName: `Deep ${unique}`, whatsapp: '5511999999999' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie }
}

async function product(owner, name) {
  const response = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ name, sku: `SKU-${name.slice(-5)}`, price: 89.9, category: 'Deep', mediaUrl: 'https://example.invalid/deep.jpg', mediaType: 'image', variations: [{ name: 'Tamanho', options: ['P', 'M'] }], active: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Produto: ${response.status} ${JSON.stringify(body)}`)
  return body.product
}

const owner = await register()
const target = await product(owner, `Produto alvo ${unique}`)
for (let i = 0; i < 28; i += 1) await product(owner, `Produto novo ${i} ${unique}`)

const response = await fetch(`${base}/api/public/store/${owner.storeSlug}?q=${encodeURIComponent(target.id)}`, { headers: { 'user-agent': 'Mozilla/5.0 ShopvaxTest' } })
const body = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(`Busca direta: ${response.status} ${JSON.stringify(body)}`)
if (body.products?.length !== 1 || body.products[0]?.id !== target.id) throw new Error('Deep link não resolveu exatamente o produto solicitado.')
if (!feedSource.includes("?produto=${encodeURIComponent(productId)}") || !feedSource.includes('openStore(post.store.slug, post.product.id)')) throw new Error('Feed não aponta o CTA para o produto específico.')
if (!feedSource.includes('storePath(post.store.slug, post.product.id)')) throw new Error('Compartilhamento não usa link específico do produto.')
if (!storeSource.includes("new URLSearchParams(window.location.search).get('produto')") || !storeSource.includes('openPicker(product)')) throw new Error('Loja não abre automaticamente o produto vindo do feed.')

console.log('social module 12 ok')
