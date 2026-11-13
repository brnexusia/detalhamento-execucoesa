import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const app=readFileSync('server/app.mjs','utf8')
const platform=readFileSync('server/platform-hooks.mjs','utf8')
const phase2=readFileSync('server/phase2-operation-hooks.mjs','utf8')
const dashboard=readFileSync('src/ShopvaxDashboard.tsx','utf8')
const orders=readFileSync('src/ShopvaxOrders.tsx','utf8')

test('all monetary order summaries exclude cancelled orders',()=>{
  assert.match(app, /coalesce\(sum\(total\),0\)::numeric FROM orders WHERE store_id=\$1 AND status<>'cancelled'/)
  assert.match(platform, /coalesce\(sum\(total\),0\)::numeric FROM orders WHERE status<>'cancelled'/)
  assert.match(platform, /coalesce\(sum\(o\.total\),0\)::numeric FROM orders o WHERE o\.store_id=s\.id AND o\.status<>'cancelled'/)
  assert.match(phase2, /COALESCE\(sum\(o\.total\) FILTER \(WHERE o\.status<>'cancelled'\),0\)::numeric AS orders_value/)
  assert.match(dashboard, /data\.orders\.filter\(\(order\)=>order\.status!=='cancelled'\)/)
  assert.match(orders, /Não contabilizado/)
})

test('actual PostgreSQL aggregation counts only non-cancelled values per store', async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required for real SQL verification')
  const client=new pg.Client({connectionString:process.env.DATABASE_URL})
  await client.connect()
  try{
    await client.query('CREATE TEMP TABLE orders (store_id text NOT NULL,status text NOT NULL,total numeric NOT NULL)')
    await client.query(`INSERT INTO orders(store_id,status,total) VALUES 
      ('galego','whatsapp',200),('galego','confirmado',50),
      ('galego','cancelled',10000),('outra-loja','confirmado',9999)`)
    const selected=app.match(/\(SELECT coalesce\(sum\(total\),0\)::numeric FROM orders WHERE store_id=\$1 AND status<>'cancelled'\) AS value/)
    assert(selected,'Cannot extract real production subquery')
    const expression=selected[0].replace(/ AS value$/,'')
    const result=await client.query('SELECT '+expression+' AS value',['galego'])
    assert.equal(Number(result.rows[0].value),250)
    const empty=await client.query('SELECT '+expression+' AS value',['sem-pedidos'])
    assert.equal(Number(empty.rows[0].value),0)
  }finally {await client.end()}
})
