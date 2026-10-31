import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'

// This tool inserts synthetic rows. Refuse to run outside a disposable local test DB.
const db = new URL(process.env.DATABASE_URL || 'postgresql://x:x@invalid/invalid')
const api = new URL(process.env.BASE_URL || 'http://127.0.0.1:3000')
const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
if (process.env.SHOPVAX_PERF_LOCAL_ONLY !== '1' || !isLocal(db.hostname) ||
    !isLocal(api.hostname) || !/(_test|_perf)$/.test(db.pathname)) {
  throw new Error('Requires SHOPVAX_PERF_LOCAL_ONLY=1, localhost API and disposable localhost database *_test / *_perf.')
}
const pool = new pg.Pool({ connectionString: db.toString(), max: 3 })
const prefix = 'perf' + Date.now().toString(36)
const rows = []
let ownerId = '', storeId = '', extraStores = 0
async function call(path, cookie = '', method = 'GET', body) {
  const start = performance.now()
  const response = await fetch(new URL(path, api), {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const bytes = await response.arrayBuffer()
  let json = null
  try { json = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch {}
  return { status: response.status, ms: performance.now()-start, bytes: bytes.byteLength, json, response }
}
function pct(arr, p) {
  const sorted = [...arr].sort((a,b)=>a-b)
  return Math.round(sorted[Math.max(0, Math.ceil(p*sorted.length)-1)]*10)/10
}
async function sample(label, path, cookie, scenario) {
  const warm = await call(path,cookie)
  assert.equal(warm.status,200,label+' warmup failed')
  const measures=[]
  for (let n=0;n<6;n++) measures.push(...await Promise.all(Array.from({length:4},()=>call(path,cookie))))
  assert.ok(measures.every(m=>m.status===200),label+' concurrent request failed')
  rows.push({ ...scenario, endpoint:label, requests:measures.length, concurrency:4,
    p50Ms:pct(measures.map(m=>m.ms),.5),p95Ms:pct(measures.map(m=>m.ms),.95),
    p99Ms:pct(measures.map(m=>m.ms),.99), responseBytes:warm.bytes })
}
async function stores(target) {
  if(target<=extraStores)return
  await pool.query("INSERT INTO users(id,email,name) SELECT $1 || '-u-' || n, $1 || '-u-' || n || '@example.test', 'Perf fixture' FROM generate_series($2::int,$3::int) n", [prefix,extraStores+1,target])
  await pool.query("INSERT INTO stores(id,owner_id,slug,name,plan_tier) SELECT $1 || '-s-' || n,$1 || '-u-' || n,$1 || '-s-' || n,'Perf test store','ouro' FROM generate_series($2::int,$3::int) n", [prefix,extraStores+1,target])
  extraStores=target
}
async function products(from,to) {
  await pool.query("INSERT INTO products(id,store_id,sku,name,price,category) SELECT $1 || '-p-' || n,$2,'REF-' || n,'Camiseta ' || n,59.9,CASE WHEN n%2=0 THEN 'Blusas' ELSE 'Calças' END FROM generate_series($3::int,$4::int) n", [prefix,storeId,from+1,to])
  await pool.query('ANALYZE products')
}
try {
  const sign=await call('/api/auth/register','', 'POST',{name:'Performance Fixture',email:prefix+'@example.test',
    password:'perf-test-12345678',storeName:'Perf '+prefix,whatsapp:'5511999999999',planCode:'ouro'})
  assert.equal(sign.status,201,JSON.stringify(sign.json))
  const cookie=sign.response.headers.get('set-cookie')?.split(';')[0] || ''
  assert.ok(cookie.startsWith('atacado_session='))
  const meta=await call('/api/admin/bootstrap?compact=1',cookie)
  assert.equal(meta.status,200)
  ownerId=meta.json.user.id
  storeId=meta.json.store.id
  // Operational dashboard must still support a screen with 100 recent orders.
  await pool.query(
    "INSERT INTO orders(id,code,store_id,total,items,status) SELECT $1 || '-o-' || n, $1 || '-code-' || n, $2, 59.9, '[]'::jsonb, 'whatsapp' FROM generate_series(1,100) n",
    [prefix,storeId],
  )
  let previous=0
  for(const [productCount,storeTarget] of [[500,9],[5000,99],[20000,999]]) {
    await products(previous,productCount)
    previous=productCount
    await stores(storeTarget)
    const scenario={products:productCount,simulatedStores:extraStores+1}
    await sample('legacy-bootstrap','/api/admin/bootstrap',cookie,scenario)
    await sample('compact-bootstrap','/api/admin/bootstrap?compact=1',cookie,scenario)
    await sample('product-page','/api/admin/products?page=1&limit=18',cookie,scenario)
    await sample('product-search','/api/admin/products?page=2&limit=18&q=camiseta&category=Blusas',cookie,scenario)
    const recent=await call('/api/admin/bootstrap?compact=1',cookie)
    assert.equal(recent.json.orders.length,100)
    const explain=await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM products WHERE store_id=$1 ORDER BY created_at DESC,id DESC LIMIT 18',[storeId])
    const plan=explain.rows[0]['QUERY PLAN'][0]
    const connections=await pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()')
    const size=await pool.query('SELECT pg_database_size(current_database())::bigint AS n')
    rows.push({...scenario,endpoint:'explain-buffers',planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],
      plan:plan.Plan,connectionsAtSample:connections.rows[0].n,databaseBytes:Number(size.rows[0].n)})
  }
  const report={type:'controlled-lab-baseline',timestamp:new Date().toISOString(),
    environment:{node:process.version,postgres:'PostgreSQL 16 temporary CI service',concurrency:4,
      note:'Products concentrated in one shop; simulated stores are database rows, NOT simultaneous merchant sessions. Server CPU/RSS, mobile Web Vitals and production behavior not measured.'},
    rows}
  await writeFile('/tmp/shopvax-admin-performance.json',JSON.stringify(report,null,2))
  console.log('SHOPVAX_PERF_RESULTS '+JSON.stringify(report))
} finally {
  // The entire PostgreSQL service is disposed after the workflow. Avoid leftover local fixtures too.
  if (ownerId) await pool.query('DELETE FROM users WHERE id=$1',[ownerId]).catch(()=>{})
  if (extraStores) await pool.query("DELETE FROM users WHERE id LIKE $1",[prefix+'-u-%']).catch(()=>{})
  await pool.end()
}
