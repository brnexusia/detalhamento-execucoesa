/**
 * One-time MAMA public Google Photos import. Not wired into app startup.
 * Preview: node scripts/import-mama-once.mjs
 * Collect (review only): node scripts/import-mama-once.mjs --apply
 * Publication is intentionally not automated: photos missed by OCR need visual verification.
 *
 * Uses the existing scanner and publisher in the deployed container.
 * Photos whose price was not confidently parsed remain in review; no
 * invented prices or products for other accounts are ever published.
 */
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { links } from './mama-public-album-links.mjs'
import { ensureScannerSchema, processImportJob, processNormalizationJob } from '../server/scanner-hooks.mjs'
import { collectCatalog } from '../server/scanner-collector.mjs'
import { publishJob } from '../server/scanner-publish-hooks.mjs'
import { prepareReview } from '../server/scanner-review.mjs'
import { MAMA_IMPORT_MARKER, canonicalMamaName, prepareMamaPhoto } from '../server/mama-import-plan.mjs'

const apply = process.argv.includes('--apply')
const publishVerified = process.argv.includes('--publish-verified')
const reviewOnly = !publishVerified
const timeoutMs = 12 * 60 * 60 * 1000
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms))
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000})
pool.on('error',e=>console.error('[mama] pool:',e.message))

async function tenantAndCatalog() {
  const names = await pool.query("SELECT id,name,slug,plan_tier FROM stores WHERE lower(name) LIKE '%mama%'")
  const matches = names.rows.filter(s=>canonicalMamaName(s.name)==='mama acessorios')
  if(matches.length!==1)throw Error('Esperada uma única conta exatamente chamada Mama Acessórios; encontradas: '+matches.length)
  const store=matches[0]
  const catalogs=await pool.query('SELECT id,name FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true',[store.id])
  if(catalogs.rowCount!==1)throw Error('Catálogo padrão da Mama inexistente ou ambíguo.')
  const plans=await pool.query('SELECT product_limit FROM platform_plans WHERE code=$1 AND active=true',[store.plan_tier])
  if(plans.rowCount!==1)throw Error('Plano da Mama sem configuração de limites.')
  return {store,catalog:catalogs.rows[0],limit:plans.rows[0].product_limit}
}

async function jobFor(storeId,url) {
  const prior=await pool.query(
    'SELECT id,status,error FROM import_jobs WHERE store_id=$1 AND source_host=$2 AND source_url=$3 ORDER BY created_at DESC LIMIT 1',
    [storeId,MAMA_IMPORT_MARKER,url])
  if(prior.rows[0] && !['failed','cancelled'].includes(prior.rows[0].status))return prior.rows[0]
  const id=crypto.randomUUID()
  const created=await pool.query(
    "INSERT INTO import_jobs(id,store_id,source_url,source_host,status,platform) VALUES($1,$2,$3,$4,'queued','google-photos') RETURNING id,status,error",
    [id,storeId,url,MAMA_IMPORT_MARKER])
  return created.rows[0]
}

async function awaitJob(jobId,accepted) {
  const start=Date.now()
  let lastLog=0
  while(Date.now()-start<timeoutMs) {
    const found=await pool.query('SELECT status,progress,error FROM import_jobs WHERE id=$1',[jobId])
    if(!found.rowCount)throw Error('Job não encontrado: '+jobId)
    const row=found.rows[0]
    if(accepted.includes(row.status))return row
    if(['failed','cancelled'].includes(row.status))throw Error('Job '+jobId+': '+(row.error||row.status))
    if(Date.now()-lastLog>30000) {
      console.log('[mama] processamento',JSON.stringify({jobId,status:row.status,progress:row.progress}))
      lastLog=Date.now()
    }
    await sleep(2000)
  }
  throw Error('Tempo limite do job '+jobId+'. Reexecute o comando para retomar.')
}

async function stageAlbum(job) {
  if(['completed','review'].includes(job.status))return job
  if(job.status==='queued') {
    const scanned=await processImportJob(job.id,async(url,opts)=>{
      const result=await collectCatalog(url,{...opts,maxProducts:10000})
      if(Number(result.skipped||0)>0)throw Error('Álbum incompleto: '+result.skipped+' foto(s) sem download.')
      return result
    })
    if(!scanned)throw Error('Outro worker iniciou a coleta. Não foi possível garantir a completude; verifique o job.')
    if(scanned.status==='failed')throw Error(scanned.error||'Falha na coleta.')
    job=scanned
  } else {
    job=await awaitJob(job.id,['processing','review','completed'])
  }
  if(job.status==='processing') {
    const normalized=await processNormalizationJob(job.id)
    if(normalized?.status==='failed')throw Error(normalized.error||'Falha na normalização.')
    job=normalized||await awaitJob(job.id,['review','completed'])
  }
  if(job.status==='completed')return job
  await awaitJob(job.id,['review'])
  return {...job,status:'review'}
}

async function selectPricedPhotos(jobId,storeId,album,url,visualDecisions) {
  const rows=await pool.query(
    'SELECT n.id,n.normalized_data,n.review_data,n.selected,c.raw_data AS candidate '+
    'FROM import_normalized_products n JOIN import_candidates c '+
    'ON c.id=n.source_candidate_id AND c.store_id=n.store_id '+
    'WHERE n.store_id=$1 AND n.job_id=$2 ORDER BY n.created_at,n.id',
    [storeId,jobId])
  const batch=[]
  let priced=0,unresolved=0,protectedEdits=0,visuallyConfirmed=0,confirmedNoPrice=0
  for(const row of rows.rows) {
    const photoKey=String(row.candidate?.source_image_key||'')
    if (!/^[A-Za-z0-9_-]{22}$/.test(photoKey)) throw Error('Job antigo ou foto sem identidade estável: '+jobId+'. Recapture o álbum antes de publicar.')
    if(row.review_data) {
      if(row.selected && /^MAMA-[A-F0-9]{22}$/.test(String(row.review_data.sku||'')))priced++
      else protectedEdits++
      continue
    }
    const key=url+'#photo:'+photoKey
    let normalized=row.normalized_data
    if(visualDecisions?.has(key)) {
      const verified=visualDecisions.get(key)
      if(verified===null){confirmedNoPrice++;continue}
      normalized={...normalized,price:verified}
      visuallyConfirmed++
    }
    const product=prepareMamaPhoto({album,albumUrl:url,candidate:row.candidate,normalized,requireStableIdentity:true})
    if(!product.eligible){unresolved++;continue}
    const review=prepareReview(product.data)
    if(!review.publishable||!review.data.images?.length){unresolved++;continue}
    batch.push({id:row.id,data:review.data,warnings:review.warnings,confidence:review.confidence})
    priced++
  }
  for(let i=0;i<batch.length;i+=100) {
    const chunk=batch.slice(i,i+100)
    const written=await pool.query(
      'UPDATE import_normalized_products n SET review_data=x.data,warnings=x.warnings,'+
      'confidence=x.confidence,selected=true,review_updated_at=now(),updated_at=now() '+
      'FROM jsonb_to_recordset($1::jsonb) AS x(id text,data jsonb,warnings jsonb,confidence numeric) '+
      'WHERE n.id=x.id AND n.job_id=$2 AND n.store_id=$3 AND n.review_data IS NULL',
      [JSON.stringify(chunk),jobId,storeId])
    if(written.rowCount!==chunk.length)throw Error('Revisões concorrentes: verifique o job '+jobId)
  }
  await pool.query(
    'UPDATE import_jobs j SET '+
    'selected_count=(SELECT COUNT(*)::int FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 AND selected=true),'+
    'review_changed_count=(SELECT COUNT(*)::int FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 AND review_data IS NOT NULL),'+
    "updated_at=now() WHERE j.id=$1 AND j.store_id=$2 AND j.status='review'",
    [jobId,storeId])
  return {enumerated:rows.rowCount,priced,unresolved,protectedEdits,visuallyConfirmed,confirmedNoPrice}
}


async function preserveUnpricedForReview(jobId,storeId,url) {
  const pending=await pool.query(
    'SELECT n.fingerprint,n.normalized_data,n.review_data,n.warnings,n.confidence,'+
    'c.source_key,c.source_url,c.raw_data FROM import_normalized_products n '+
    'JOIN import_candidates c ON c.id=n.source_candidate_id AND c.store_id=n.store_id '+
    'WHERE n.job_id=$1 AND n.store_id=$2 AND n.selected=false ORDER BY n.created_at,n.id',
    [jobId,storeId])
  if(!pending.rowCount)return null
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    // Replays never create another pending-review job for the same album.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      ['mama-pending:'+storeId+':'+url])
    const prior=await client.query(
      'SELECT id FROM import_jobs WHERE store_id=$1 AND source_url=$2 AND source_host=$3 ORDER BY created_at DESC LIMIT 1',
      [storeId,url,'mama-pending-20261118'])
    if(prior.rowCount) {
      await client.query('COMMIT')
      return prior.rows[0].id
    }
    const pendingJobId=crypto.randomUUID()
    await client.query(
      "INSERT INTO import_jobs(id,store_id,source_url,source_host,status,platform,progress,result_count,normalized_count,warning_count) "+
      "VALUES($1,$2,$3,'mama-pending-20261118','review','google-photos',100,$4,$4,$5)",
      [pendingJobId,storeId,url,pending.rowCount,
        pending.rows.filter(r=>Array.isArray(r.warnings)&&r.warnings.length>0).length])
    for(let i=0;i<pending.rowCount;i+=100) {
      const batch=pending.rows.slice(i,i+100).map(row=>({
        cid:crypto.randomUUID(),nid:crypto.randomUUID(),source_key:row.source_key,
        source_url:row.source_url,raw_data:row.raw_data,
        fingerprint:row.fingerprint,normalized_data:row.normalized_data,
        review_data:row.review_data,warnings:row.warnings,
        confidence:Number(row.confidence)||0,
      }))
      await client.query(
        'INSERT INTO import_candidates(id,job_id,store_id,source_key,source_url,raw_data) '+
        'SELECT x.cid,$1,$2,x.source_key,x.source_url,x.raw_data '+
        'FROM jsonb_to_recordset($3::jsonb) AS x('+
        'cid text,source_key text,source_url text,raw_data jsonb)',
        [pendingJobId,storeId,JSON.stringify(batch)])
      await client.query(
        'INSERT INTO import_normalized_products '+
        '(id,job_id,store_id,source_candidate_id,fingerprint,normalized_data,review_data,warnings,confidence,selected) '+
        'SELECT x.nid,$1,$2,x.cid,x.fingerprint,x.normalized_data,x.review_data,x.warnings,x.confidence,false '+
        'FROM jsonb_to_recordset($3::jsonb) AS x('+
        'nid text,cid text,fingerprint text,normalized_data jsonb,review_data jsonb,warnings jsonb,confidence numeric)',
        [pendingJobId,storeId,JSON.stringify(batch)])
    }
    await client.query('COMMIT')
    return pendingJobId
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{})
    throw e
  } finally {client.release()}
}

async function ensureRoom(storeId,limit,jobId) {
  const [current,wanted]=await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM products WHERE store_id=$1',[storeId]),
    pool.query("SELECT DISTINCT review_data->>'sku' AS sku FROM import_normalized_products WHERE job_id=$1 AND store_id=$2 AND selected=true",
      [jobId,storeId]),
  ])
  const skuList=wanted.rows.map(x=>x.sku).filter(Boolean)
  if(!skuList.length)return 0
  const found=await pool.query('SELECT DISTINCT sku FROM products WHERE store_id=$1 AND sku=ANY($2::text[])',[storeId,skuList])
  const existing=new Set(found.rows.map(x=>x.sku))
  const newCount=skuList.filter(s=>!existing.has(s)).length
  if(limit!==null && current.rows[0].count+newCount>Number(limit)) {
    throw Error('Limite do plano excedido: existentes='+current.rows[0].count+', novos='+newCount+
      ', limite='+limit+'. Os itens continuam em revisão.')
  }
  return newCount
}

async function publish(jobId,storeId,catalogId) {
  const res={statusCode:200,payload:null,status(v){this.statusCode=v;return this},json(v){this.payload=v;return this}}
  await publishJob({
    params:{jobId},body:{mode:'grouped',catalogId},
    __publishWorkerStore:{store_id:storeId},
  },res)
  if(res.statusCode>=400||res.payload?.job?.status!=='completed')
    throw Error(res.payload?.error||'Publicação sem confirmação de commit.')
  return res.payload.result
}

async function main() {
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL ausente.')
  await ensureScannerSchema()
  const {store,catalog,limit}=await tenantAndCatalog()
  let visualDecisions=null
  if(publishVerified) {
    const file=String(process.env.MAMA_VISUAL_PRICES_FILE||'').trim()
    if(!file)throw Error('Para publicar, defina MAMA_VISUAL_PRICES_FILE com decisões visuais, inclusive fotos sem preço.')
    const manifest=JSON.parse(await readFile(file,'utf8'))
    if(!manifest || typeof manifest!=='object' || Array.isArray(manifest))throw Error('Manifesto visual deve ser um objeto de chave album#photo:identidade e preço ou null.')
    visualDecisions=new Map()
    for(const [key,value] of Object.entries(manifest)) {
      if(!links.some(([,url])=>key.startsWith(url+'#photo:') && /^[A-Za-z0-9_-]{22}$/.test(key.slice((url+'#photo:').length))))throw Error('Imagem original não reconhecida no manifesto: '+key)
      if(value!==null && (!Number.isFinite(value)||value<=0))throw Error('Preço visual inválido em: '+key)
      visualDecisions.set(key,value)
    }
  }
  console.log('[mama] destino',JSON.stringify({
    name:store.name,slug:store.slug,plan:store.plan_tier,catalog:catalog.name,
    albumCount:links.length,mode:!apply?'preview':publishVerified?'publish_verified':'collect_for_visual_review',
  }))
  if(!apply) {
    console.log('[mama] Prévia apenas. Para coletar: node scripts/import-mama-once.mjs --apply')
    return
  }
  const summary=[]
  for(let i=0;i<links.length;i++) {
    const [album,url]=links[i]
    console.log('[mama] álbum',JSON.stringify({number:i+1,of:links.length,album}))
    let jobId=''
    try {
      const job=await jobFor(store.id,url)
      jobId=job.id
      const ready=await stageAlbum(job)
      if(ready.status==='completed') {
        summary.push({album,jobId,status:'already_completed'})
        continue
      }
      const review=await selectPricedPhotos(jobId,store.id,album,url,visualDecisions)
      const record={album,jobId,...review}
      if(reviewOnly)record.status='review_ready'
      else if(review.unresolved>0 || review.protectedEdits>0)throw Error('Há '+review.unresolved+' foto(s) sem decisão visual e '+review.protectedEdits+' edição(ões) prévias. Publicação bloqueada até concluir a conferência.')
      else if(review.priced===0)record.status='no_confirmed_prices'
      else {
        record.toCreate=await ensureRoom(store.id,limit,jobId)
        record.pendingReviewJobId=await preserveUnpricedForReview(jobId,store.id,url)
        const result=await publish(jobId,store.id,catalog.id)
        record.status='published'
        record.created=result.created
        record.skippedExisting=result.skipped_existing
      }
      summary.push(record)
      console.log('[mama] resultado',JSON.stringify(record))
    } catch(e) {
      const failed={album,jobId,status:'requires_attention',error:String(e.message||e).slice(0,300)}
      summary.push(failed)
      console.error('[mama] problema',JSON.stringify(failed))
    }
  }
  const totals={
    albums:summary.length,
    created:summary.reduce((n,x)=>n+Number(x.created||0),0),
    unresolved:summary.reduce((n,x)=>n+Number(x.unresolved||0),0),
    requiresAttention:summary.filter(x=>x.status==='requires_attention').length,
  }
  console.log('MAMA_IMPORT_FINAL '+JSON.stringify({totals,albums:summary}))
  if(totals.requiresAttention)process.exitCode=1
}

try { await main() }
catch(e) {console.error('[mama] erro fatal:',e.message||e);process.exitCode=1}
finally {await pool.end()}
