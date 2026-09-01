const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

const register = await fetch(`${base}/api/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Interações', email: `interacoes-${unique}@example.com`, password: 'senha-social-123', storeName: `Interações ${unique}`, whatsapp: '5511999999999' }),
})
const registration = await register.json().catch(() => ({}))
const ownerCookie = register.headers.get('set-cookie')?.split(';')[0] || ''
if (!register.ok || !ownerCookie) throw new Error(`Loja de interações não criada: ${register.status} ${JSON.stringify(registration)}`)

const productResponse = await fetch(`${base}/api/admin/products`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
  body: JSON.stringify({ name: `Interação ${unique}`, description: 'Produto social', price: 59.9, category: 'Social', mediaUrl: 'https://example.invalid/social.jpg', mediaType: 'image', active: true }),
})
const productPayload = await productResponse.json().catch(() => ({}))
if (!productResponse.ok) throw new Error(`Produto social não criado: ${productResponse.status} ${JSON.stringify(productPayload)}`)
const productId = productPayload.product.id

const profileResponse = await fetch(`${base}/api/social/stores/${registration.storeSlug}`)
const profile = await profileResponse.json().catch(() => ({}))
const visitorCookie = profileResponse.headers.get('set-cookie')?.split(';')[0] || ''
if (!profileResponse.ok || !visitorCookie || !profile.store?.id) throw new Error('Perfil não criou sessão anônima social.')
const storeId = profile.store.id

async function action(path) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: visitorCookie } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

const view1 = await action(`/api/social/posts/${productId}/view`)
const view2 = await action(`/api/social/posts/${productId}/view`)
if (view1.views !== 1 || view2.views !== 1) throw new Error('Views deveriam ser deduplicadas por visitante e publicação.')

const likeOn = await action(`/api/social/posts/${productId}/like`)
const likeOff = await action(`/api/social/posts/${productId}/like`)
if (likeOn.liked !== true || likeOn.likes !== 1 || likeOff.liked !== false || likeOff.likes !== 0) throw new Error('Toggle de curtida inválido.')

const followOn = await action(`/api/social/stores/${storeId}/follow`)
const followOff = await action(`/api/social/stores/${storeId}/follow`)
if (followOn.following !== true || followOn.followers !== 1 || followOff.following !== false || followOff.followers !== 0) throw new Error('Toggle de seguir inválido.')

const share1 = await action(`/api/social/posts/${productId}/share`)
const share2 = await action(`/api/social/posts/${productId}/share`)
if (share1.shares !== 1 || share2.shares !== 2) throw new Error('Contagem de compartilhamentos inválida.')

const feedResponse = await fetch(`${base}/api/social/feed?limit=20`, { headers: { cookie: visitorCookie } })
const feed = await feedResponse.json().catch(() => ({}))
const post = feed.posts?.find((item) => item.id === productId)
if (!post || post.interactions?.views !== 1 || post.interactions?.shares !== 2) throw new Error('Feed não retornou as métricas sociais da publicação.')

console.log('social module 5 ok')
