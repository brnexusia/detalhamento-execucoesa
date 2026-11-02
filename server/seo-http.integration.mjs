import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const prefix = 'seo-' + crypto.randomUUID().slice(0, 9)
const userId = crypto.randomUUID()
const storeId = crypto.randomUUID()
const activeId = crypto.randomUUID()
const draftId = crypto.randomUUID()
const hiddenId = crypto.randomUUID()
const catalogId = crypto.randomUUID()
const email = prefix + '@example.invalid'
const slug = prefix
const url = (path) => base + path
const get = async (path) => {
  const res = await fetch(url(path), { redirect: 'manual' })
  return { status: res.status, headers: res.headers, text: await res.text() }
}
const includes = (text, expected) => assert.ok(text.includes(expected), 'Missing ' + expected)

try {
  await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$3)', [userId, email, 'SEO integration fixture'])
  await pool.query('INSERT INTO stores(id,owner_id,slug,name,tagline,is_active,social_enabled) VALUES($1,$2,$3,$4,$5,true,true)',
    [storeId, userId, slug, 'Loja de teste SEO', 'Teste de catalogo sem dados de clientes'])
  await pool.query('INSERT INTO catalogs(id,store_id,slug,name,is_default,active) VALUES($1,$2,$3,$4,true,true)',
    [catalogId, storeId, 'geral', 'Geral'])
  for (const [id, name, active] of [[activeId, 'Produto SEO visivel', true], [draftId, 'Produto nao publicado', false], [hiddenId, 'Produto oculto no catalogo', true]]) {
    await pool.query('INSERT INTO products(id,store_id,sku,name,price,active) VALUES($1,$2,$3,$4,10,$5)',
      [id, storeId, id, name, active])
  }
  await pool.query('INSERT INTO catalog_products(catalog_id,product_id,visible) VALUES($1,$2,false)', [catalogId, hiddenId])
  const robots = await get('/robots.txt')
  assert.equal(robots.status, 200)
  includes(robots.text, 'Sitemap: https://shopvax.com.br/sitemap.xml')
  includes(robots.text, 'Disallow: /api/')
  const index = await get('/sitemap.xml')
  assert.equal(index.status, 200)
  includes(index.text, '/sitemap-pages.xml')
  includes(index.text, '/sitemap-stores-1.xml')
  includes(index.text, '/sitemap-products-1.xml')
  const stores = await get('/sitemap-stores-1.xml')
  assert.equal(stores.status, 200)
  includes(stores.text, 'https://shopvax.com.br/' + slug)
  includes(stores.text, 'https://shopvax.com.br/perfil/' + slug)
  const products = await get('/sitemap-products-1.xml')
  assert.equal(products.status, 200)
  includes(products.text, activeId)
  assert.equal(products.text.includes(draftId), false)
  assert.equal(products.text.includes(hiddenId), false)
  assert.equal(products.text.includes(email), false)
  const product = await get('/' + slug + '?produto=' + activeId)
  assert.equal(product.status, 200)
  includes(product.text, '<link rel="canonical" href="https://shopvax.com.br/' + slug + '?produto=' + activeId + '"')
  includes(product.text, '"@type":"Product"')
  includes(product.text, 'Produto SEO visivel')
  assert.equal(product.text.includes(email), false)
  const listing = await get('/' + slug)
  assert.equal(listing.status, 200)
  includes(listing.text, '"@type":"Store"')
  const param = await get('/' + slug + '?q=secreto')
  assert.equal(param.status, 200)
  includes(param.text, 'noindex,nofollow,noarchive')
  const privatePage = await get('/painel')
  assert.equal(privatePage.status, 200)
  includes(privatePage.text, 'noindex,nofollow,noarchive')
  assert.match(privatePage.headers.get('x-robots-tag') || '', /noindex/)
  const hidden = await get('/' + slug + '?produto=' + hiddenId)
  assert.equal(hidden.status, 404)
  assert.match(hidden.headers.get('x-robots-tag') || '', /noindex/)
  await pool.query('UPDATE products SET active=false,updated_at=now() WHERE id=$1', [activeId])
  const removed = await get('/sitemap-products-1.xml')
  assert.equal(removed.text.includes(activeId), false)
  const missing = await get('/' + slug + '?produto=' + activeId)
  assert.equal(missing.status, 404)
  await pool.query('UPDATE stores SET is_active=false,updated_at=now() WHERE id=$1', [storeId])
  const removedStore = await get('/sitemap-stores-1.xml')
  assert.equal(removedStore.text.includes(slug), false)
  const inactive = await get('/' + slug)
  assert.equal(inactive.status, 404)
  console.log('SEO HTTP integration passed: robots/sitemaps/metadata/security/lifecycle')
} finally {
  await pool.query('DELETE FROM users WHERE id=$1', [userId]).catch((e) => console.error('SEO fixture cleanup:', e.message))
  await pool.end()
}
