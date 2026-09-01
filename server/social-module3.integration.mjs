const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

const registrationResponse = await fetch(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Publicador Social',
    email: `publish-${unique}@example.com`,
    password: 'senha-social-123',
    storeName: `Publicações ${unique}`,
    whatsapp: '5511999999999',
  }),
})
const registration = await registrationResponse.json().catch(() => ({}))
const cookie = registrationResponse.headers.get('set-cookie')?.split(';')[0] || ''
if (!registrationResponse.ok || !registration.storeSlug || !cookie) throw new Error(`Cadastro inválido: ${registrationResponse.status} ${JSON.stringify(registration)}`)

async function createProduct(name, active) {
  const response = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name,
      sku: `SKU-${name}`,
      description: 'Produto publicado automaticamente na rede Shopvax.',
      price: 79.9,
      category: 'Teste social',
      mediaUrl: 'https://example.invalid/produto.jpg',
      mediaType: 'image',
      variations: [{ name: 'Tamanho', options: ['P', 'M'] }],
      active,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Produto não criado: ${response.status} ${JSON.stringify(body)}`)
  return body.product
}

const activeProduct = await createProduct('Produto ativo', true)
await createProduct('Produto oculto', false)

const publicationsResponse = await fetch(`${base}/api/social/stores/${registration.storeSlug}/publications`)
const payload = await publicationsResponse.json().catch(() => ({}))
if (!publicationsResponse.ok) throw new Error(`Publicações não abriram: ${publicationsResponse.status} ${JSON.stringify(payload)}`)
if (payload.publications?.length !== 1) throw new Error(`Esperava 1 publicação ativa, recebi ${payload.publications?.length}`)
const publication = payload.publications[0]
if (publication.id !== activeProduct.id || publication.name !== 'Produto ativo') throw new Error('Produto ativo não virou a publicação esperada.')
if (publication.mediaType !== 'image' || !publication.publishedAt) throw new Error('Metadados da publicação incompletos.')
if (!Array.isArray(publication.variations) || publication.variations[0]?.name !== 'Tamanho') throw new Error('Variações não foram preservadas na publicação.')

console.log('social module 3 ok')
