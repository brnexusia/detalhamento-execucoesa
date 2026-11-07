import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { ensureSocialDailyViews, dailySocialViewInsertSQL } from './social-daily-views-schema.mjs'
import { ensureSchema as ensureIntentSchema, recordEvents } from './analytics-features-hooks.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL needed for integration test')
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL})
const id = (name) => 'test-'+name+'-'+crypto.randomUUID()
const storeId=id('store'), productId=id('product'), secondProductId=id('second')
const visitor='v-'+crypto.randomUUID(), another='v-'+crypto.randomUUID()

test('daily product and store views: concurrency, local calendar boundary, legacy migration',async()=>{
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS stores (id text PRIMARY KEY)')
    await pool.query('CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY)')
    await pool.query('CREATE TABLE IF NOT EXISTS social_post_views (product_id text REFERENCES products(id) ON DELETE CASCADE,store_id text REFERENCES stores(id) ON DELETE CASCADE,visitor_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(product_id,visitor_key))')
    await pool.query('INSERT INTO stores(id) VALUES($1)',[storeId])
    await pool.query('INSERT INTO products(id) VALUES($1),($2)',[productId,secondProductId])
    // Historical once-per-lifetime views must survive migration.
    await pool.query('INSERT INTO social_post_views(product_id,store_id,visitor_key,created_at) VALUES($1,$2,$3,$4)',[productId,storeId,visitor,'2026-11-06T19:00:00Z'])
    await ensureSocialDailyViews(pool)
    const legacy=await pool.query('SELECT view_day FROM social_post_daily_views WHERE product_id=$1',[productId])
    assert.equal(legacy.rows.length,1)
    assert.equal(legacy.rows[0].view_day.toISOString().slice(0,10),'2026-11-06')
  } finally {
    // Independent subtests in this file reuse the connection; do not drop schema.
  }
})
test('social views count once a day but reset next local day',async()=>{
  await Promise.all(Array.from({length:12},()=>pool.query(dailySocialViewInsertSQL,[productId,storeId,visitor])))
  await Promise.all(Array.from({length:12},()=>pool.query(dailySocialViewInsertSQL,[secondProductId,storeId,visitor])))
  await pool.query("INSERT INTO social_post_daily_views (product_id,store_id,visitor_key,view_day) VALUES($1,$2,$3,((now() AT TIME ZONE 'America/Sao_Paulo')::date+1)) ON CONFLICT DO NOTHING",[productId,storeId,visitor])
  await pool.query(dailySocialViewInsertSQL,[productId,storeId,another])
  const result=await pool.query('SELECT product_id,count(*)::int AS count FROM social_post_daily_views WHERE store_id=$1 GROUP BY product_id',[storeId])
  const counts=Object.fromEntries(result.rows.map(x=>[x.product_id,x.count]))
  assert.equal(counts[productId],4) // old day + today + tomorrow + other visitor
  assert.equal(counts[secondProductId],1)
})
test('catalog views count once per day and independently per product, not per reload',async()=>{
  await ensureIntentSchema()
  const event=(kind,person,product)=>({storeId,sellerId:null,catalogId:null,productId:product,kind,visitorKey:person})
  const batch=[
    ...Array.from({length:12},()=>event('access',visitor,null)),
    ...Array.from({length:12},()=>event('product_view',visitor,productId)),
    event('product_view',visitor,secondProductId),
    event('product_view',another,productId),
  ]
  await recordEvents(batch)
  await recordEvents(batch)
  const rows=await pool.query("SELECT kind,COALESCE(product_id,'') AS product_id,COUNT(*)::int AS n FROM intent_events WHERE store_id=$1 GROUP BY kind,COALESCE(product_id,'') ORDER BY kind,product_id",[storeId])
  const counts=Object.fromEntries(rows.rows.map(x=>[x.kind+':'+x.product_id,x.n]))
  assert.equal(counts['access:'],1)
  assert.equal(counts['product_view:'+productId],2)
  assert.equal(counts['product_view:'+secondProductId],1)
  await pool.query("INSERT INTO intent_events (id,store_id,kind,visitor_key,product_id,view_day) VALUES($1,$2,'product_view',$3,$4,((now() AT TIME ZONE 'America/Sao_Paulo')::date+1))",[crypto.randomUUID(),storeId,visitor,productId])
  const nextDay=await pool.query("SELECT count(*)::int AS n FROM intent_events WHERE store_id=$1 AND kind='product_view' AND product_id=$2",[storeId,productId])
  assert.equal(nextDay.rows[0].n,3)
})
test.after(async()=>{await pool.query('DELETE FROM intent_events WHERE store_id=$1',[storeId]).catch(()=>{});await pool.query('DELETE FROM social_post_views WHERE store_id=$1',[storeId]).catch(()=>{});await pool.query('DELETE FROM social_post_daily_views WHERE store_id=$1',[storeId]).catch(()=>{});await pool.query('DELETE FROM products WHERE id=ANY($1)',[[productId,secondProductId]]).catch(()=>{});await pool.query('DELETE FROM stores WHERE id=$1',[storeId]).catch(()=>{});await pool.end()})
