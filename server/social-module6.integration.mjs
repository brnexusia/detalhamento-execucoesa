const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function registerStore(label, whatsapp) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: label, email: `${label.toLowerCase()}-${unique}@example.com`, password: 'senha-social-123', storeName: `${label} ${unique}`, whatsapp }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${label}: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie }
}

async function createSeller(cookie, name, phone) {
  const response = await fetch(`${base}/api/admin/sellers`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, phone, isActive: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Vendedora ${name}: ${response.status} ${JSON.stringify(body)}`)
  return body.seller
}

async function createProduct(cookie, name) {
  const response = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, sku: `REF-${name.slice(-4)}`, description: 'Produto para perguntar', price: 79.9, category: 'Social', mediaUrl: 'https://example.invalid/ask.jpg', mediaType: 'image', active: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Produto ${name}: ${response.status} ${JSON.stringify(body)}`)
  return body.product
}

async function visitorFor(slug) {
  const response = await fetch(`${base}/api/social/stores/${slug}`)
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Visitante ${slug}: ${response.status} ${JSON.stringify(body)}`)
  return cookie
}

async function ask(productId, cookie) {
  const response = await fetch(`${base}/api/social/posts/${productId}/ask`, { method: 'POST', headers: { cookie } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Perguntar ${productId}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

const main = await registerStore('Perguntar', '5511988800000')
const sellerA = await createSeller(main.cookie, 'Ana', '5511991111111')
const sellerB = await createSeller(main.cookie, 'Bia', '5511992222222')
const productA = await createProduct(main.cookie, `Produto A ${unique}`)
const productB = await createProduct(main.cookie, `Produto B ${unique}`)

const visitorA = await visitorFor(main.storeSlug)
const askA1 = await ask(productA.id, visitorA)
const askA2 = await ask(productB.id, visitorA)
if (!askA1.seller?.id || askA1.seller.id !== askA2.seller.id) throw new Error('Afinidade da vendedora não foi preservada para o mesmo visitante.')
if (![sellerA.id, sellerB.id].includes(askA1.seller.id)) throw new Error('Perguntar não resolveu uma vendedora ativa.')
const message = new URL(askA1.whatsappUrl).searchParams.get('text') || ''
if (!message.includes(productA.name) || !message.includes('Shopvax')) throw new Error('Mensagem do WhatsApp não levou o contexto do produto.')

const visitorB = await visitorFor(main.storeSlug)
const askB = await ask(productA.id, visitorB)
if (!askB.seller?.id || askB.seller.id === askA1.seller.id) throw new Error('Distribuição entre vendedoras não balanceou novos visitantes.')

const fallback = await registerStore('Fallback', '5511977700000')
const fallbackProduct = await createProduct(fallback.cookie, `Fallback ${unique}`)
const fallbackVisitor = await visitorFor(fallback.storeSlug)
const fallbackAsk = await ask(fallbackProduct.id, fallbackVisitor)
if (fallbackAsk.seller?.id !== null || !fallbackAsk.whatsappUrl.includes('5511977700000')) throw new Error('Fallback para WhatsApp principal da loja falhou.')

console.log('social module 6 ok')
