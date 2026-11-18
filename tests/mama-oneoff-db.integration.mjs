import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import sharp from 'sharp'
import { processImportJob, processNormalizationJob } from '../server/scanner-hooks.mjs'
import { publishJob } from '../server/scanner-publish-hooks.mjs'
import { prepareReview } from '../server/scanner-review.mjs'
import { prepareMamaPhoto, mamaPhotoSku } from '../server/mama-import-plan.mjs'

// Database-backed rehearsal of the exact read -> normalize -> review ->
// publish flow. Data is fictional and stays in the CI PostgreSQL service.
// The real 3980-photo OCR coverage is audited separately.
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000'
const ALBUM_URL = 'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const TOTAL = 200
const OCR_MISSED = 7
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6 })
async function register(storeName, prefix) {
  const response = await fetch(BASE_URL+'/api/auth/register',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      name:'Teste de Importação',email:prefix+'-'+crypto.randomUUID()+'@example.test',
      password:'test-mama-2026',storeName,whatsapp:'5511999999999',planCode:'bronze',
    }),
  })
  assert.equal(response.status,201,'não conseguiu registrar a conta fictícia '+storeName+': '+await response.text())
  const cookie=response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  const c=await fetch(BASE_URL+'/api/admin/bootstrap',{headers:{Cookie:cookie}})
  assert.equal(c.status,200)
  const payload=await c.json()
  assert.ok(payload)
  const shop=await db.query('SELECT id FROM stores WHERE name=$1 ORDER BY created_at DESC LIMIT 1',[storeName])
  assert.equal(shop.rowCount,1)
  const catalog=await db.query('SELECT id FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true',[shop.rows[0].id])
  assert.equal(catalog.rowCount,1)
  return {cookie,storeId:shop.rows[0].id,catalogId:catalog.rows[0].id}
}

async function publish(jobId,storeId,catalogId){
  const res={statusCode:200,payload:null,status(code){this.statusCode=code;return this},json(v){this.payload=v;return this}}
  await publishJob({
    params:{jobId},body:{mode:'grouped',catalogId},
    __publishWorkerStore:{store_id:storeId},
  },res)
  assert.equal(res.statusCode,200,JSON.stringify(res.payload))
  assert.equal(res.payload.job.status,'completed')
  return res.payload.result
}

async function rehearsal(mama,media) {
  const jobId=crypto.randomUUID()
  await db.query(
    "INSERT INTO import_jobs(id,store_id,source_url,source_host,status,platform) VALUES($1,$2,$3,$4,'queued','google-photos')",
    [jobId,mama.storeId,ALBUM_URL,'mama-ci',])
  const candidates=Array.from({length:TOTAL},(_,i)=>{
    const n=i+1
    const externalId='foto-'+String(n).padStart(4,'0')
    const detectedPrice=n>TOTAL-OCR_MISSED?null:Math.round((10+n/10)*100)/100
    return {
      source_url:ALBUM_URL+'#'+externalId,
      external_id:externalId,title:n%3===0?'Brinco':'Foto importada '+String(n).padStart(3,'0'),
      description:'',sku:'',pack:'1 peça',category:'Geral',
      images:[media[i]],price:detectedPrice,currency:'BRL',
      source:'google-photos-shared',
    }
  })
  const collected=await processImportJob(jobId,async()=>({
    platform:'google-photos',pagesScanned:1,candidateCount:TOTAL,skipped:0,candidates,
  }))
  assert.equal(collected.status,'processing')
  assert.equal(collected.result_count,TOTAL)
  const normalized=await processNormalizationJob(jobId)
  assert.equal(normalized.status,'review')
  assert.equal(normalized.normalized_count,TOTAL,
    'cada foto individual deve permanecer na normalização')
  const stored=await db.query(
    'SELECT n.id,n.normalized_data,c.raw_data FROM import_normalized_products n '+
    'JOIN import_candidates c ON c.id=n.source_candidate_id '+
    'WHERE n.job_id=$1 AND n.store_id=$2 ORDER BY n.created_at,n.id',
    [jobId,mama.storeId])
  assert.equal(stored.rowCount,TOTAL)
  const rows=stored.rows.map(row=>{
    const raw=row.raw_data
    const n=Number(raw.external_id.split('-')[1])
    const normalizedPrice=row.normalized_data.price==null?Math.round((10+n/10)*100)/100:row.normalized_data.price
    const prepared=prepareMamaPhoto({
      album:'Brincos',albumUrl:ALBUM_URL,candidate:raw,
      normalized:{...row.normalized_data,price:normalizedPrice},
    })
    assert.equal(prepared.eligible,true)
    const review=prepareReview(prepared.data)
    assert.equal(review.publishable,true)
    assert.equal(review.data.price,Math.round((10+n/10)*100)/100)
    assert.equal(review.data.sku,mamaPhotoSku(ALBUM_URL,raw.external_id))
    return {id:row.id,data:review.data,warnings:review.warnings,confidence:review.confidence}
  })
  for(let i=0;i<rows.length;i+=50) {
    const chunk=rows.slice(i,i+50)
    const result=await db.query(
      'UPDATE import_normalized_products p SET review_data=x.data,warnings=x.warnings,'+
      'confidence=x.confidence,selected=true,review_updated_at=now(),updated_at=now() '+
      'FROM jsonb_to_recordset($1::jsonb) AS x(id text,data jsonb,warnings jsonb,confidence numeric) '+
      'WHERE p.id=x.id AND p.job_id=$2 AND p.store_id=$3',
      [JSON.stringify(chunk),jobId,mama.storeId])
    assert.equal(result.rowCount,chunk.length)
  }
  await db.query('UPDATE import_jobs SET selected_count=$1 WHERE id=$2 AND store_id=$3',[TOTAL,jobId,mama.storeId])
  const published=await publish(jobId,mama.storeId,mama.catalogId)
  return {jobId,published}
}

try {
  const mama=await register('Mama Acessórios','mama-e2e')
  const other=await register('Loja Controle Integração','other-e2e')
  const img=await sharp({create:{width:480,height:600,channels:3,background:'#b2a1aa'}})
    .jpeg({quality:84}).toBuffer()
  const images=[]
  for(let i=0;i<TOTAL;i++) {
    const asset=crypto.randomUUID()
    await db.query(
      'INSERT INTO media_assets(id,store_id,mime_type,original_name,byte_size,data) VALUES($1,$2,$3,$4,$5,$6)',
      [asset,mama.storeId,'image/jpeg','mama-ci-'+i+'.jpg',img.length,img])
    images.push('/media/'+asset)
  }
  const first=await rehearsal(mama,images)
  assert.equal(first.published.created,TOTAL)
  assert.equal(first.published.skipped_existing,0)
  let products=await db.query('SELECT id,name,sku,price,media_url,category FROM products WHERE store_id=$1',[mama.storeId])
  assert.equal(products.rowCount,TOTAL)
  assert.equal(new Set(products.rows.map(x=>x.sku)).size,TOTAL)
  assert.equal(new Set(products.rows.map(x=>x.media_url)).size,TOTAL)
  assert.ok(products.rows.every(x=>x.name&&x.price>0&&x.category==='Brincos'))
  const members=await db.query('SELECT count(*)::int AS n FROM catalog_products cp '+
    'JOIN products p ON p.id=cp.product_id WHERE p.store_id=$1 AND cp.catalog_id=$2 AND cp.visible=true',
    [mama.storeId,mama.catalogId])
  assert.equal(members.rows[0].n,TOTAL)
  const second=await rehearsal(mama,images)
  assert.equal(second.published.created,0,'reimportação não cria duplicados')
  assert.equal(second.published.skipped_existing,TOTAL)
  products=await db.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1',[mama.storeId])
  assert.equal(products.rows[0].n,TOTAL)
  const otherProducts=await db.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1',[other.storeId])
  assert.equal(otherProducts.rows[0].n,0,'nenhum dado da Mama pode ir para outra loja')
  console.log('MAMA_DB_IMPORT_E2E '+JSON.stringify({
    images:TOTAL,recognizedInitially:TOTAL-OCR_MISSED,manuallyRecovered:OCR_MISSED,
    createdFirst:TOTAL,skippedExistingSecond:TOTAL,otherStoreProducts:0,
    savedCoveragePercent:100,
  }))
} finally { await db.end() }
