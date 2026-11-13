// Runs only against an ephemeral CI database and local Shopvax server.
// Verifies the real ranked-feed SQL and compact catalog cursor path.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

const base = String(process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

async function get(path, cookie = '') {
  const response = await fetch(base + path, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  })
  const payload = await response.json().catch(() => ({}))
  assert.equal(response.status, 200, path + ': ' + JSON.stringify(payload))
  return { payload, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie }
}

try {
  // An earlier integration step creates active stores and catalog defaults.
  const storeResult = await pool.query(`
    SELECT s.id,s.slug FROM stores s
    WHERE s.is_active=true AND EXISTS (
      SELECT 1 FROM catalogs c WHERE c.store_id=s.id AND c.is_default=true
    )
    ORDER BY s.created_at ASC LIMIT 1
  `)
  assert.ok(storeResult.rowCount, 'No seeded store with a default catalog')
  const store = storeResult.rows[0]

  // Local CI data only: create two products to guarantee a next page.
  const productIds = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [index, id] of productIds.entries()) {
    await pool.query(`
      INSERT INTO products
      (id,store_id,sku,name,description,price,category,media_url,media_type,
       active,social_published,social_published_at)
      VALUES ($1,$2,$3,$4,'Teste de paginação',12.34,'Teste Público','',
              'image',true,true,now())
    `, [id, store.id, 'CI-PUBLIC-' + index, 'Produto público ' + index])
  }

  const feed = await get('/api/social/feed?limit=30')
  assert.ok(Array.isArray(feed.payload.posts), 'Feed has no posts array')
  assert.ok(feed.payload.page && feed.payload.ranking, 'Feed pagination/ranking missing')
  assert.ok(feed.payload.posts.length > 0, 'Seeded public products missing from feed')
  for (const post of feed.payload.posts) {
    assert.equal(post.product.price, null, 'Feed must not reveal commercial prices')
    assert.ok(post.store?.id && post.product?.id, 'Post lacks store/product')
    assert.ok(Number.isFinite(post.interactions?.likes), 'Post interaction counts missing')
  }

  const first = await get('/api/public/store/' + encodeURIComponent(store.slug) + '?limit=1')
  assert.equal(first.payload.products.length, 1)
  assert.ok(Array.isArray(first.payload.categories), 'Initial categories missing')
  assert.ok(Array.isArray(first.payload.catalogs), 'Initial catalog choices missing')
  assert.ok(first.payload.page?.hasMore && first.payload.page.nextCursor, 'Cursor not generated')

  const cursorQuery = '?limit=1&cursor=' + encodeURIComponent(first.payload.page.nextCursor)
  const full = await get('/api/public/store/' + encodeURIComponent(store.slug) + cursorQuery, first.cookie)
  assert.ok(Array.isArray(full.payload.categories), 'Legacy/full cursor metadata changed')
  assert.ok(Array.isArray(full.payload.catalogs), 'Legacy/full cursor catalog choices changed')

  const compact = await get('/api/public/store/' + encodeURIComponent(store.slug) +
    cursorQuery + '&compactPage=1', first.cookie)
  assert.equal(compact.payload.products.length, 1)
  assert.notEqual(compact.payload.products[0].id, first.payload.products[0].id)
  assert.equal(compact.payload.categories, undefined, 'Compact page repeated categories')
  assert.equal(compact.payload.catalogs, undefined, 'Compact page repeated catalogs')
  assert.equal(compact.payload.products[0].price, full.payload.products[0].price,
    'Compact page changed the commercial price')
  assert.equal(compact.payload.products[0].id, full.payload.products[0].id,
    'Compact page changed the product order')

  console.log('PUBLIC_BUYER_PERFORMANCE_SMOKE_OK', JSON.stringify({
    feedPosts: feed.payload.posts.length,
    storeSlug: store.slug,
    firstProduct: first.payload.products[0].id,
    nextProduct: compact.payload.products[0].id,
  }))
} finally {
  await pool.end()
}
