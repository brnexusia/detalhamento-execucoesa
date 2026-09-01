const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function createStore(suffix) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `Feed ${suffix}`,
      email: `feed-${suffix}-${unique}@example.com`,
      password: 'senha-social-123',
      storeName: `Feed ${suffix} ${unique}`,
      whatsapp: '5511999999999',
    }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !body.storeSlug || !cookie) throw new Error(`Loja feed não criada: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie }
}

async function createProduct(cookie, name, mediaType) {
  const response = await fetch(`${base}/api/admin/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name,
      description: `Publicação ${mediaType} do feed geral.`,
      price: 99.9,
      category: 'Feed',
      mediaUrl: mediaType === 'video' ? 'https://example.invalid/produto.mp4' : 'https://example.invalid/produto.jpg',
      mediaType,
      active: true,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Produto feed não criado: ${response.status} ${JSON.stringify(body)}`)
  return body.product
}

const storeA = await createStore('A')
const storeB = await createStore('B')
const nameA = `Foto feed ${unique}`
const nameB = `Vídeo feed ${unique}`
await createProduct(storeA.cookie, nameA, 'image')
await new Promise((resolve) => setTimeout(resolve, 5))
await createProduct(storeB.cookie, nameB, 'video')

const feedResponse = await fetch(`${base}/api/social/feed?limit=10`)
const feed = await feedResponse.json().catch(() => ({}))
if (!feedResponse.ok) throw new Error(`Feed não abriu: ${feedResponse.status} ${JSON.stringify(feed)}`)
const names = new Set((feed.posts || []).map((post) => post.product?.name))
if (!names.has(nameA) || !names.has(nameB)) throw new Error('Feed geral não misturou publicações das duas lojas de teste.')
const video = feed.posts.find((post) => post.product?.name === nameB)
if (video?.product?.mediaType !== 'video' || !video?.store?.slug) throw new Error('Post de vídeo não preservou mídia e origem da loja.')

const firstPageResponse = await fetch(`${base}/api/social/feed?limit=1`)
const firstPage = await firstPageResponse.json().catch(() => ({}))
if (!firstPageResponse.ok || firstPage.posts?.length !== 1) throw new Error('Primeira página do feed inválida.')
if (firstPage.page?.hasMore && !firstPage.page?.nextCursor) throw new Error('Feed informou mais páginas sem cursor.')
if (firstPage.page?.nextCursor) {
  const secondResponse = await fetch(`${base}/api/social/feed?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`)
  const second = await secondResponse.json().catch(() => ({}))
  if (!secondResponse.ok || second.posts?.length !== 1) throw new Error('Segunda página do feed inválida.')
  if (second.posts[0]?.id === firstPage.posts[0]?.id) throw new Error('Paginação repetiu a mesma publicação.')
}

console.log('social module 4 ok')
