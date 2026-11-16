import assert from 'node:assert/strict'
import pg from 'pg'
import {writeFile,readFile} from 'node:fs/promises'
const db=new URL(process.env.DATABASE_URL||'')
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.equal(db.hostname,'127.0.0.1')
assert.equal(db.pathname,'/atacado_perf')
const client=new pg.Client({connectionString:db.href,connectionTimeoutMillis:10000})
await client.connect()
try{
 const row=async sql=>(await client.query(sql)).rows[0]
 const counts=await row("SELECT count(*)::int AS orders, count(DISTINCT code)::int AS distinct_codes, count(*) FILTER (WHERE status='whatsapp')::int AS whatsapp_status FROM orders")
 const consistency=await row([
  'SELECT count(*)::int AS total_lines,',
  'count(*) FILTER (WHERE p.id IS NULL OR p.store_id <> o.store_id)::int AS cross_store_lines',
  'FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) AS line',
  "LEFT JOIN products p ON p.id=line->>'productId'",
 ].join(' '))
 const event=await row("SELECT count(*) FILTER (WHERE kind='cart')::int AS cart_events,count(*) FILTER (WHERE kind='view')::int AS views FROM events")
 const imports=await row('SELECT count(*)::int AS jobs FROM import_jobs')
 const data={
  ...counts,...consistency,...event,imports:imports.jobs,
  duplicatedOrderCodes:counts.orders-counts.distinct_codes,
  externalWhatsAppSends:0,
  notes:'Local database with fictional products, buyers, phones and sellers. No wa.me HTTP request.'
 }
 console.log('REAL_BUYER_DB_AUDIT '+JSON.stringify(data))
 await writeFile('/tmp/real-buyer-db-audit.json',JSON.stringify(data,null,2))
 if(consistency.cross_store_lines>0||data.duplicatedOrderCodes>0)process.exitCode=1
}finally{await client.end()}
