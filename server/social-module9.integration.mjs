import fs from 'node:fs'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
if (!appSource.includes("pathname === '/' || pathname === '' || pathname === '/feed' || pathname === '/descobrir') return 'social'")) {
  throw new Error('A raiz pública não está configurada para abrir o feed social.')
}
if (!appSource.includes("pathname === '/para-lojas') return 'home'")) throw new Error('A apresentação para lojistas não foi preservada em /para-lojas.')

async function createStore(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: label, email: `${label.toLowerCase()}-${unique}@example.com`, password: 'senha-social-123', storeName: `${label}-${unique}`, whatsapp: '5511999999999' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${label}: ${response.status} ${JSON.stringify(body)}`)
  return { ...body, cookie }
}

async function createProduct(owner, name) {
  const response = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ name, price: 99.9, category: 'Navegação', mediaUrl: 'https://example.invalid/nav.jpg', mediaType: 'image', active: true }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Produto ${name}: ${response.status} ${JSON.stringify(body)}`)
  return body.product
}

const lojaA = await createStore('NavegacaoA')
const lojaB = await createStore('NavegacaoB')
const produtoA = await createProduct(lojaA, `Produto A ${unique}`)
const produtoB = await createProduct(lojaB, `Produto B ${unique}`)

for (const path of ['/', '/feed', '/descobrir', '/para-lojas', `/${lojaA.storeSlug}`, `/${lojaB.storeSlug}`]) {
  const response = await fetch(`${base}${path}`)
  const type = response.headers.get('content-type') || ''
  if (!response.ok || !type.includes('text/html')) throw new Error(`Rota pública ${path} não entregou a aplicação: ${response.status} ${type}`)
}

async function publications(slug) {
  const response = await fetch(`${base}/api/social/stores/${slug}/publications`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Publicações ${slug}: ${response.status} ${JSON.stringify(body)}`)
  return body.publications || []
}

const postsA = await publications(lojaA.storeSlug)
const postsB = await publications(lojaB.storeSlug)
if (!postsA.some((post) => post.id === produtoA.id) || postsA.some((post) => post.id === produtoB.id)) throw new Error('Perfil A misturou produtos de outra loja.')
if (!postsB.some((post) => post.id === produtoB.id) || postsB.some((post) => post.id === produtoA.id)) throw new Error('Perfil B misturou produtos de outra loja.')

const feedResponse = await fetch(`${base}/api/social/feed?limit=30`)
const feed = await feedResponse.json().catch(() => ({}))
if (!feedResponse.ok || !feed.posts?.some((post) => post.id === produtoA.id) || !feed.posts?.some((post) => post.id === produtoB.id)) {
  throw new Error('Feed geral não reuniu produtos de lojas distintas.')
}

console.log('social module 9 ok')
