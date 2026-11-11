import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import sharp from 'sharp'
import { prepareReview } from './scanner-review.mjs'

const root=process.env.BASE_URL || 'http://127.0.0.1:3000'
const db=new pg.Pool({connectionString:process.env.DATABASE_URL})
const identifier=()=>crypto.randomUUID()
const call=async(path,cookie,method='GET',body)=>{
 const res=await fetch(root+path,{method,headers:{
  ...(cookie?{Cookie:cookie}:{}),
  'Content-Type':'application/json',
 },...(body?{body:JSON.stringify(body)}:{})})
 const data=await res.json().catch(()=>null)
 return {res,data}
}
const started=await call('/api/auth/register','', 'POST',{
 name:'Alexandre recovery test',email:'alexandre-recovery-'+identifier()+'@example.test',
 password:'scanner1234',storeName:'Loja Teste Alexandre',whatsapp:'5511999999999',planCode:'bronze',
})
assert.equal(started.res.status,201,JSON.stringify(started.data))
const cookie=started.res.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
const bytes=await sharp({create:{width:30,height:30,channels:3,background:'#d8bbbb'}}).png().toBuffer()
const newJob=async(status,count)=>{
 const r=await call('/api/admin/imports',cookie,'POST',{url:'https://bijouxalexandre.com.br/'})
 assert.equal(r.res.status,201,JSON.stringify(r.data))
 const job=r.data.job
 await db.query(`UPDATE import_jobs SET status=$1,platform='alexandre-bijoux',
    progress=100,result_count=$2,normalized_count=$2,selected_count=$2
  WHERE id=$3`,[status,count,job.id])
 return job
}
const job=await newJob('review',3)
// Initialize publisher schema through its own API before seeding legacy records.
const schemaWarmup=await call('/api/admin/imports/'+job.id+'/publish-preview',cookie)
assert.equal(schemaWarmup.res.status,200,JSON.stringify(schemaWarmup.data))
const owner=await db.query('SELECT store_id FROM import_jobs WHERE id=$1',[job.id])
const store=owner.rows[0].store_id
const images=[]
for(let i=0;i<3;i++){
 const mediaId=identifier()
 await db.query(
  'INSERT INTO media_assets(id,store_id,mime_type,original_name,byte_size,data) VALUES($1,$2,$3,$4,$5,$6)',
  [mediaId,store,'image/png','photo-'+i+'.png',bytes.length,bytes])
 images.push('/media/'+mediaId)
}
async function seedRows(jobId,existingProductId=''){
 const rows=[]
 for(let i=0;i<3;i++){
  const candidateId=identifier(),normalId=identifier()
  const sourceId='alex-fixture-'+jobId+'-'+i
  const item=prepareReview({
   name:'BRINCO',price:24,sku:'',category:'BRINCO',brand:'Alexandre Bijoux',
   source_url:'https://bijouxalexandre.com.br/',source:'alexandre-bijoux-public-api',
   media_url:images[i],images:[images[i]],currency:'BRL',
  })
  await db.query(
   `INSERT INTO import_candidates(id,job_id,store_id,source_key,source_url,raw_data)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
   [candidateId,jobId,store,sourceId,'https://bijouxalexandre.com.br/',JSON.stringify({external_id:sourceId})])
  await db.query(
   `INSERT INTO import_normalized_products
    (id,job_id,store_id,source_candidate_id,fingerprint,normalized_data,review_data,warnings,confidence,selected,published_product_id,publish_result)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$6::jsonb,'[]'::jsonb,1,true,$7,$8)`,
   [normalId,jobId,store,candidateId,'external:'+sourceId,JSON.stringify(item.data),existingProductId || null,existingProductId?'created':''])
  rows.push(normalId)
 }
 return rows
}
const newRows=await seedRows(job.id)
const initial=await call('/api/admin/imports/'+job.id+'/publish-preview',cookie)
assert.equal(initial.res.status,200,JSON.stringify(initial.data))
assert.equal(initial.data.preview.publication_count,3,'3 equal names/prices must remain distinct')
const catalogs=await call('/api/admin/catalogs',cookie)
assert.equal(catalogs.res.status,200,JSON.stringify(catalogs.data))
const catalogId=catalogs.data.catalogs.find(item=>item.isDefault)?.id
assert.ok(catalogId)
const missingTarget=await call('/api/admin/imports/'+job.id+'/publish-async',cookie,'POST',{mode:'grouped'})
assert.equal(missingTarget.res.status,400,'Publish must never fall back to retail/default implicitly')
const startPublish=await call('/api/admin/imports/'+job.id+'/publish-async',cookie,'POST',{mode:'grouped',catalogId})
assert.equal(startPublish.res.status,202,JSON.stringify(startPublish.data))
assert.equal(startPublish.data.progress.state,'queued')
assert.equal(startPublish.data.progress.catalogId,catalogId)
const secondStart=await call('/api/admin/imports/'+job.id+'/publish-async',cookie,'POST',{mode:'grouped',catalogId})
assert.equal(secondStart.res.status,202,JSON.stringify(secondStart.data))
const denied=await call('/api/admin/imports/'+job.id+'/publish-progress','')
assert.equal(denied.res.status,401,'Only authenticated store owner can poll progress')
let published
let lastProgress
for(let i=0;i<100;i++){
  const poll=await call('/api/admin/imports/'+job.id+'/publish-progress',cookie)
  assert.equal(poll.res.status,200,JSON.stringify(poll.data))
  lastProgress=poll.data.progress
  if(lastProgress?.state==='failed')throw Error('Background worker failed: '+lastProgress.error)
  if(lastProgress?.state==='finished'){
    published={data:lastProgress.result}
    break
  }
  await new Promise(resolve=>setTimeout(resolve,250))
}
assert.ok(published,'Asynchronous job should finish and be pollable: '+JSON.stringify(lastProgress))
assert.equal(lastProgress.percent,100)
assert.equal(published.data.result.created,3)
assert.equal(published.data.job.target_catalog_id,catalogId)
const linked=await db.query('SELECT count(*)::int AS n FROM catalog_products WHERE catalog_id=$1',[catalogId])
assert.equal(linked.rows[0].n,3,'All published items must belong to the selected catalog')
const productIds=await db.query('SELECT COUNT(DISTINCT published_product_id)::int AS n FROM import_normalized_products WHERE job_id=$1',[job.id])
assert.equal(productIds.rows[0].n,3)
const oldJob=await newJob('completed',3)
const oldId=identifier()
await db.query(
 `INSERT INTO products
 (id,store_id,sku,name,description,price,category,media_url,media_type,images,variant_images,pack,variations,featured,active)
 VALUES($1,$2,'','BRINCO','',24,'BRINCO',$3,'image',$4::jsonb,'[]'::jsonb,'','[]'::jsonb,false,true)`,
 [oldId,store,images[1],JSON.stringify(images)],
)
const legacyRows=await seedRows(oldJob.id,oldId)
await db.query('UPDATE import_jobs SET published_count=1,publish_mode=$1 WHERE id=$2',['grouped',oldJob.id])
const preview=await call('/api/admin/imports/'+oldJob.id+'/recover-alexandre-preview',cookie)
assert.equal(preview.res.status,200,JSON.stringify(preview.data))
assert.deepEqual(preview.data.preview,{selected:3,preserved:1,missing:2,recoverable:true})
const recovered=await call('/api/admin/imports/'+oldJob.id+'/recover-alexandre',cookie,'POST',{confirm:true,expectedMissing:2})
assert.equal(recovered.res.status,200,JSON.stringify(recovered.data))
assert.equal(recovered.data.recovered,2)
const after=await db.query('SELECT count(DISTINCT published_product_id)::int AS unique_products FROM import_normalized_products WHERE job_id=$1',[oldJob.id])
assert.equal(after.rows[0].unique_products,3)
const original=await db.query('SELECT media_url,images FROM products WHERE id=$1',[oldId])
assert.equal(original.rows[0].media_url,images[1])
assert.deepEqual(original.rows[0].images,images)
const repeat=await call('/api/admin/imports/'+oldJob.id+'/recover-alexandre',cookie,'POST',{confirm:true,expectedMissing:0})
assert.equal(repeat.res.status,200,JSON.stringify(repeat.data))
assert.equal(repeat.data.idempotent,true)
assert.equal(repeat.data.recovered,0)
const assigned=await call('/api/admin/imports/'+oldJob.id+'/assign-catalog',cookie,'POST',{catalogId})
assert.equal(assigned.res.status,200,JSON.stringify(assigned.data))
assert.equal(assigned.data.assigned,3,'Legacy published products remain recoverable')
const prices=await db.query('SELECT price_override FROM catalog_products WHERE catalog_id=$1 AND product_id=$2',[catalogId,oldId])
assert.equal(Number(prices.rows[0]?.price_override),24)
const assignedAgain=await call('/api/admin/imports/'+oldJob.id+'/assign-catalog',cookie,'POST',{catalogId})
assert.equal(assignedAgain.data.idempotent,true)
console.log('PUBLISH_ASYNC_DB_INTEGRATION_OK',JSON.stringify({
 newProducts:published.data.result.created,oldIdPreserved:true,recovered:recovered.data.recovered,
 total:recovered.data.total_published,
}))
await db.end()
