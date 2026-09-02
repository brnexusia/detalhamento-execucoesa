import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000'
if (!databaseUrl) throw new Error('DATABASE_URL ausente.')

const packageJson = await fs.readFile('package.json', 'utf8')
const dockerfile = await fs.readFile('Dockerfile', 'utf8')
const feedSource = await fs.readFile('src/SocialFeed.tsx', 'utf8')
if (!packageJson.includes('--import ./server/page-metadata-hooks.mjs')) throw new Error('Metadata hook ausente no npm start.')
if (!dockerfile.includes('"./server/page-metadata-hooks.mjs"')) throw new Error('Metadata hook ausente no Docker de produção.')
if (!feedSource.includes("document.execCommand('copy')")) throw new Error('Compartilhamento não possui fallback de cópia.')
if (!feedSource.includes('storePath(post.store.slug, post.product.id)')) throw new Error('Compartilhamento perdeu o deep link do produto.')

const pool = new Pool({ connectionString: databaseUrl, max: 2 })
const suffix = crypto.randomBytes(5).toString('hex')
const userId = `m17-user-${suffix}`
const storeId = `m17-store-${suffix}`
const productId = `m17-product-${suffix}`
const slug = `m17-${suffix}`

try {
  await pool.query(
    'INSERT INTO users (id,email,name,password_hash) VALUES ($1,$2,$3,$4)',
    [userId, `m17-${suffix}@example.test`, 'Meta Teste', 'salt:hash'],
  )
  await pool.query(
    `INSERT INTO stores (id,owner_id,slug,name,tagline,logo_url,whatsapp)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [storeId, userId, slug, 'Loja & Meta', 'Catálogo especial & atacado.', 'https://cdn.example.test/logo.jpg', '5511999999999'],
  )
  await pool.query(
    `INSERT INTO products (id,store_id,sku,name,description,price,category,media_url,media_type,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'image',true)`,
    [productId, storeId, 'META-1', 'Bolsa <Premium>', 'Produto "especial" & pronto para pedido.', 129.9, 'Bolsas', 'https://cdn.example.test/produto.jpg'],
  )

  const productResponse = await fetch(`${baseUrl}/${slug}?produto=${encodeURIComponent(productId)}`)
  if (!productResponse.ok) throw new Error(`Deep link HTML respondeu ${productResponse.status}.`)
  const productHtml = await productResponse.text()
  if (!productHtml.includes('<title>Bolsa &lt;Premium&gt; · Loja &amp; Meta | Shopvax</title>')) throw new Error('Título do produto não foi injetado/escapado corretamente.')
  if (!productHtml.includes('property="og:title" content="Bolsa &lt;Premium&gt; · Loja &amp; Meta | Shopvax"')) throw new Error('OG title do produto ausente.')
  if (!productHtml.includes('property="og:image" content="https://cdn.example.test/produto.jpg"')) throw new Error('OG image do produto ausente.')
  if (!productHtml.includes(`property="og:url" content="${baseUrl}/${slug}?produto=${productId}"`)) throw new Error('OG URL não preserva o deep link do produto.')
  if (!productHtml.includes('Produto &quot;especial&quot; &amp; pronto para pedido.')) throw new Error('Descrição do produto não foi escapada corretamente.')

  const storeResponse = await fetch(`${baseUrl}/${slug}`)
  const storeHtml = await storeResponse.text()
  if (!storeHtml.includes('<title>Loja &amp; Meta | Shopvax</title>')) throw new Error('Título da loja não foi injetado.')
  if (!storeHtml.includes('Catálogo especial &amp; atacado.')) throw new Error('Descrição da loja não foi injetada.')

  const feedResponse = await fetch(`${baseUrl}/`)
  const feedHtml = await feedResponse.text()
  if (!feedHtml.includes('<title>Shopvax</title>')) throw new Error('Metadata padrão do feed foi alterada indevidamente.')

  console.log('social module 17 ok')
} finally {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => undefined)
  await pool.end()
}
