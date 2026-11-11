/**
 * Integration for the real import-job DB state machine. No external FácilZap
 * requests are needed: test the same persisted checkpoint and automatic retry
 * path used after an ECONNRESET during a multi-thousand product crawl.
 */
import assert from 'node:assert/strict'
import pg from 'pg'
import { processImportJob, processNormalizationJob } from './scanner-hooks.mjs'
import { requeueFailedTransientFacilZapScans } from './scanner-scan-lease.mjs'

const db=new pg.Pool({ connectionString: process.env.DATABASE_URL })
const base=process.env.BASE_URL || 'http://127.0.0.1:3000'
const email='facilzap-resume-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'@example.test'
let jobId

const product=n=>({
  source_url:'https://facilzap.com.br/galegobijoux/produto/'+n,
  external_id:String(n),
  title:'Brinco galego '+n,
  sku:'FZ-'+n,
  category:'Brincos',
  images:['https://arquivos.facilzap.app.br/produtos/'+n+'.webp'],
  price:29.9,
  price_text:'29,90',
  currency:'BRL',
  availability:'InStock',
  source:'facilzap',
  variants:[],
  properties:[],
})

try {
  const registration=await fetch(base+'/api/auth/register',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      name:'Resume Galego Test',
      email,password:'scanner1234',storeName:'Loja Resume Galego',
      whatsapp:'5511999999999',planCode:'bronze',
    }),
  })
  assert.equal(registration.status,201,'Fixture owner registration')
  const cookie=registration.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  const jobResponse=await fetch(base+'/api/admin/imports',{
    method:'POST',
    headers:{'Content-Type':'application/json',Cookie:cookie},
    body:JSON.stringify({url:'https://facilzap.com.br/galegobijoux/11952148150'}),
  })
  assert.equal(jobResponse.status,201,'Create real scanner import job')
  jobId=(await jobResponse.json()).job.id

  const interrupted=await processImportJob(jobId,async(_url,options)=>{
    await options.onProgress({progress:54,pagesScanned:2965,candidates:0,platform:'facilzap'})
    await options.onBatch([product(1)])
    await options.onPageCheckpoint({nextPage:2,pagesScanned:2965,candidates:1})
    throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'})
  })
  assert.equal(interrupted.status,'failed')
  assert.match(interrupted.error,/ECONNRESET/)
  let row=(await db.query(
    'SELECT scan_next_page,status,scan_network_retries FROM import_jobs WHERE id=$1',
    [jobId],
  )).rows[0]
  assert.equal(Number(row.scan_next_page),2)
  assert.equal(row.status,'failed')
  let count=await db.query('SELECT count(*)::int AS count FROM import_candidates WHERE job_id=$1',[jobId])
  assert.equal(count.rows[0].count,1,'Successful first page must not be deleted by ECONNRESET')
  count=await db.query('SELECT count(*)::int AS count FROM import_normalized_products WHERE job_id=$1',[jobId])
  assert.equal(count.rows[0].count,0,'A failed scan must not expose partial review products')

  await db.query("UPDATE import_jobs SET updated_at=now()-interval '30 seconds' WHERE id=$1",[jobId])
  const recovered=await requeueFailedTransientFacilZapScans(db.query.bind(db))
  assert.ok(recovered.rows.some(row=>row.id===jobId),'Worker must automatically requeue recent resets')
  row=(await db.query('SELECT status,scan_network_retries FROM import_jobs WHERE id=$1',[jobId])).rows[0]
  assert.equal(row.status,'queued')
  assert.equal(row.scan_network_retries,1)

  const finished=await processImportJob(jobId,async(_url,options)=>{
    assert.equal(options.resumePage,2,'Resume from last completed FácilZap page')
    assert.equal(options.initialCandidatesCount,1,'The already persisted product remains')
    await options.onProgress({progress:90,pagesScanned:2970,candidates:2,platform:'facilzap'})
    await options.onBatch([product(2)])
    await options.onPageCheckpoint({nextPage:3,pagesScanned:2970,candidates:2})
    return {platform:'facilzap',complete:true,pagesScanned:2970,candidateCount:2}
  })
  assert.equal(finished.status,'processing')
  assert.equal(finished.result_count,2)
  count=await db.query('SELECT count(*)::int AS count FROM import_candidates WHERE job_id=$1',[jobId])
  assert.equal(count.rows[0].count,2,'Resuming must retain earlier page and add only new products')
  const reviewed=await processNormalizationJob(jobId)
  assert.equal(reviewed.status,'review')
  assert.equal(reviewed.normalized_count,2)
  console.log('FACILZAP_ECONNRESET_CHECKPOINT_RECOVERY_REVIEW_OK')
} finally {
  if(jobId)await db.query('DELETE FROM import_jobs WHERE id=$1',[jobId]).catch(()=>{})
  await db.query('DELETE FROM users WHERE email=$1',[email]).catch(()=>{})
  await db.end()
}
