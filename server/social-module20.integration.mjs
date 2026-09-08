import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000'
if (!databaseUrl) throw new Error('DATABASE_URL ausente.')

const appSource = await fs.readFile('src/App.tsx', 'utf8')
const feedSource = await fs.readFile('src/SocialFeed.tsx', 'utf8')
const feedCss = await fs.readFile('src/social-feed.css', 'utf8')
const profileSource = await fs.readFile('src/SocialStoreProfile.tsx', 'utf8')
const publicRouteSource = await fs.readFile('src/PublicRoute.tsx', 'utf8')
const storeNavCss = await fs.readFile('src/store-social-nav.css', 'utf8')

if (!appSource.includes("pathname === '/perfil' || pathname.startsWith('/perfil/')") || !appSource.includes('<SocialStoreProfile />')) throw new Error('Perfil social não possui rota própria.')
if (publicRouteSource.includes('SocialProfileHeader') || !publicRouteSource.includes('<StoreSocialNav />')) throw new Error('Loja comercial ainda está misturada ao perfil social ou sem retorno social.')
if (!storeNavCss.includes('.view-switch') || !storeNavCss.includes('.feed-callout') || !storeNavCss.includes('display:none!important')) throw new Error('Loja comercial ainda expõe o antigo feed local e confunde com o feed global.')
if (!feedCss.includes('position:fixed;inset:0;overflow:hidden') || !feedCss.includes('overflow-y:auto') || !feedCss.includes('scroll-snap-type:y mandatory') || !feedCss.includes('height:100dvh')) throw new Error('Feed não funciona como rolagem vertical em telas.')
if (!feedCss.includes('-webkit-line-clamp:2')) throw new Error('Texto do feed ainda pode ocupar área excessiva da mídia.')
if (!feedSource.includes("post.product.mediaType === 'video'") || !feedSource.includes('videoRef.current.play()') || !feedSource.includes('social-feed-sound')) throw new Error('Suporte de vídeo do feed está incompleto.')
if (!feedSource.includes('social-feed-add') || !feedSource.includes('Adicionar') || !feedSource.includes('shopvax-cart-v1:')) throw new Error('Carrinho não está disponível diretamente no feed.')
if (!profileSource.includes('Voltar ao feed') && !profileSource.includes('<ArrowLeft size={18}/> Feed')) throw new Error('Perfil não oferece retorno interno ao feed.')
if (!profileSource.includes('className="is-store"') || !profileSource.includes('<Store size={16}/> Loja')) throw new Error('Perfil não possui botão explícito para a loja comercial.')
if (!profileSource.includes("publication.mediaType === 'video'")) throw new Error('Perfil da loja não exibe publicações em vídeo.')

const pool = new Pool({ connectionString: databaseUrl, max: 2 })
const suffix = crypto.randomBytes(5).toString('hex')
const userId = `m20-user-${suffix}`
const storeId = `m20-store-${suffix}`
const productId = `m20-video-${suffix}`
const slug = `m20-${suffix}`

try {
  await pool.query('INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [userId, `m20-${suffix}@example.test`, 'Feed UX', 'salt:hash'])
  await pool.query('INSERT INTO stores (id,owner_id,slug,name,tagline,whatsapp) VALUES ($1,$2,$3,$4,$5,$6)', [storeId, userId, slug, 'Loja Vídeo', 'Perfil social de teste', '5511999999999'])
  await pool.query(`INSERT INTO products (id,store_id,sku,name,description,price,category,media_url,media_type,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'video',true)`, [productId, storeId, 'VID-1', 'Produto em vídeo', 'Vídeo no feed', 79.9, 'Vídeos', 'https://cdn.example.test/produto.mp4'])

  const feedResponse = await fetch(`${baseUrl}/api/social/feed?limit=30`)
  const feed = await feedResponse.json().catch(() => ({}))
  const videoPost = feed.posts?.find((post) => post.id === productId)
  if (!feedResponse.ok || videoPost?.product?.mediaType !== 'video') throw new Error('API do feed não entrega publicação em vídeo corretamente.')

  const publicationsResponse = await fetch(`${baseUrl}/api/social/stores/${slug}/publications`)
  const publications = await publicationsResponse.json().catch(() => ({}))
  const videoPublication = publications.publications?.find((post) => post.id === productId)
  if (!publicationsResponse.ok || videoPublication?.mediaType !== 'video') throw new Error('Perfil da loja não recebe publicação em vídeo corretamente.')

  const profilePage = await fetch(`${baseUrl}/perfil/${slug}`)
  if (!profilePage.ok || !(profilePage.headers.get('content-type') || '').includes('text/html')) throw new Error('Rota pública do perfil social não entrega a aplicação.')

  console.log('social module 20 ok')
} finally {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => undefined)
  await pool.end()
}
