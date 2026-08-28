import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
async function register(label) {
  const r=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Discard ${label}`,email:`discard-${label}-${Date.now()}-${Math.random()}@example.test`,password:'scanner1234',storeName:`Discard ${label}`,whatsapp:'5511999999999'})})
  assert.equal(r.status,201); return r.headers.get('set-cookie')?.split(';')[0]
}
async function api(path,cookie,options={}) { return fetch(`${base}${path}`,{...options,headers:{'Content-Type':'application/json',Cookie:cookie,...(options.headers||{})}}) }
const cookie=await register('a')
let r=await api('/api/admin/imports',cookie,{method:'POST',body:JSON.stringify({url:'https://discard.fixture.example/'})}); let p=await r.json(); const jobId=p.job.id
const collector=async()=>({platform:'generic',pagesScanned:1,candidates:[{source_url:'https://discard.fixture.example/p/1',external_id:'p1',title:'Produto descartável',sku:'D1',category:'Teste',images:['https://cdn.fixture.example/d1.jpg'],properties:[],variants:[],price:10,currency:'BRL',source:'fixture'}]})
await processImportJob(jobId,collector); await processNormalizationJob(jobId)
let counts=await pool.query(`SELECT (SELECT count(*) FROM import_jobs WHERE id=$1)::int jobs,(SELECT count(*) FROM import_candidates WHERE job_id=$1)::int candidates,(SELECT count(*) FROM import_normalized_products WHERE job_id=$1)::int normalized`,[jobId])
assert.deepEqual(counts.rows[0],{jobs:1,candidates:1,normalized:1})
r=await api(`/api/admin/imports/${jobId}`,cookie,{method:'DELETE'}); assert.equal(r.status,200)
counts=await pool.query(`SELECT (SELECT count(*) FROM import_jobs WHERE id=$1)::int jobs,(SELECT count(*) FROM import_candidates WHERE job_id=$1)::int candidates,(SELECT count(*) FROM import_normalized_products WHERE job_id=$1)::int normalized`,[jobId])
assert.deepEqual(counts.rows[0],{jobs:0,candidates:0,normalized:0})
r=await api(`/api/admin/imports/${jobId}`,cookie,{method:'DELETE'}); assert.equal(r.status,404)

r=await api('/api/admin/imports',cookie,{method:'POST',body:JSON.stringify({url:'https://discard-completed.fixture.example/'})}); p=await r.json(); const completedId=p.job.id
await processImportJob(completedId,collector); await processNormalizationJob(completedId)
r=await api(`/api/admin/imports/${completedId}/publish`,cookie,{method:'POST',body:'{}'}); assert.equal(r.status,200)
r=await api('/api/admin/bootstrap',cookie); const before=(await r.json()).products.length; assert.ok(before>=1)
r=await api(`/api/admin/imports/${completedId}`,cookie,{method:'DELETE'}); assert.equal(r.status,200)
r=await api('/api/admin/bootstrap',cookie); const after=(await r.json()).products.length; assert.equal(after,before,'descartar histórico concluído não apaga produtos publicados')
await pool.end()
console.log('[scanner discard] cascade temp data + preserve published products: ok')
