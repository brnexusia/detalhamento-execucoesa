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
  // Startup migrations for catalog/social features are scheduled asynchronously.
  // Wait for their real schema; never create parallel test-only tables.
  let schemaReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    const r = await pool.query(
      "SELECT to_regclass('public.catalogs') IS NOT NULL AS catalogs, " +
      "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='stores' AND column_name='social_enabled') AS social, " +
      "EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='social_published') AS publications"
    )
    if (r.rows[0].catalogs && r.rows[0].social && r.rows[0].publications) { schemaReady = true; break }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(schemaReady, true, 'Catalog and social startup schema not ready')
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
  includes(robots.text, 'Allow: /api/public/store/')
  includes(robots.text, 'Disallow: /api/public/store/*/customers/')
  const botGet = async (path) => {
    const response = await fetch(url(path), { headers: {
      'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)'
    } })
    return {status: response.status, contentType: response.headers.get('content-type')||'', body:await response.text()}
  }
  // Marketing targets generic queries while keeping the existing visible homepage unchanged.
  const marketing = await get('/para-lojas')
  assert.equal(marketing.status, 200)
  includes(marketing.text, 'Catálogo digital para lojas e atacado')
  includes(marketing.text, 'Crie uma loja digital com catálogo de produtos')
  const discovery = await get('/')
  assert.equal(discovery.status, 200)
  includes(discovery.text, 'Lojas digitais, catálogos e produtos')

  const pages = await botGet('/sitemap-pages.xml')
  assert.equal(pages.status, 200)
  assert.match(pages.contentType, /xml/)
  includes(pages.body, 'https://shopvax.com.br/para-lojas')
  const index = await get('/sitemap.xml')
  assert.equal(index.status, 200)
  includes(index.text, '/sitemap-pages.xml')
  includes(index.text, '/sitemap-stores-1.xml')
  includes(index.text, '/sitemap-products-1.xml')
  const stores = await get('/sitemap-stores-1.xml')
  assert.equal(stores.status, 200)
  includes(stores.text, 'https://shopvax.com.br/' + slug)
  includes(stores.text, 'https://shopvax.com.br/perfil/' + slug)
  const socialProductSitemap = await get('/sitemap-social-products-1.xml')
  assert.equal(socialProductSitemap.status, 200)
  includes(socialProductSitemap.text, hiddenId)
  assert.equal(socialProductSitemap.text.includes(draftId), false)
  const products = await get('/sitemap-products-1.xml')
  assert.equal(products.status, 200)
  includes(products.text, activeId)
  assert.equal(products.text.includes(draftId), false)
  assert.equal(products.text.includes(hiddenId), false)
  assert.equal(products.text.includes(email), false)
  const botProducts = await botGet('/sitemap-products-1.xml')
  assert.equal(botProducts.status, 200)
  assert.match(botProducts.contentType, /xml/)
  includes(botProducts.body, activeId)
  const product = await get('/' + slug + '?produto=' + activeId)
  assert.equal(product.status, 200)
  includes(product.text, '<link rel="canonical" href="https://shopvax.com.br/' + slug + '?produto=' + activeId + '"')
  includes(product.text, '"@type":"Product"')
  includes(product.text, '"@type":"Offer"')
  includes(product.text, '"priceCurrency":"BRL"')
  includes(product.text, '"price":10')
  includes(product.text, '"@type":"BreadcrumbList"')
  includes(product.text, 'Produto SEO visivel')
  includes(product.text, 'catálogo digital da Loja de teste SEO')
  assert.equal(product.text.includes(email), false)
  const listing = await get('/' + slug)
  assert.equal(listing.status, 200)
  includes(listing.text, '"@type":"Store"')
  includes(listing.text, 'Loja de teste SEO — Catálogo digital | Shopvax')
  includes(listing.text, 'Explore a loja digital Loja de teste SEO')
  includes(listing.text, '"@type":"BreadcrumbList"')
  includes(listing.text, '"@type":"CollectionPage"')
  includes(listing.text, '"@type":"ItemList"')
  includes(listing.text, 'Produto SEO visivel')
  assert.equal(listing.text.includes('Produto nao publicado'), false)
  assert.equal(listing.text.includes('Produto oculto no catalogo'), false)
  assert.equal(listing.text.includes(email), false)
  const anonymous = await botGet('/api/public/store/' + slug)
  assert.equal(anonymous.status, 200)
  assert.match(anonymous.contentType, /application\/json/)
  const publicData = JSON.parse(anonymous.body)
  assert.equal(publicData.store.slug, slug)
  assert.ok(publicData.products.some((p) => p.id === activeId))
  assert.equal(anonymous.body.includes(email), false)
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
  assert.equal(removed.status, 200)
  includes(removed.text, '<urlset')
  assert.match(removed.headers.get('content-type') || '', /application\/xml/)
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
