/**
 * One-time MAMA public Google Photos import. Not wired into app startup.
 * Preview: node scripts/import-mama-once.mjs
 * Collect (review only): node scripts/import-mama-once.mjs --apply
 * The original --publish-verified flow still requires visual validation.
 * The owner-approved --remaining --publish-importable flow publishes ONLY products
 * whose price, local image and stable Google photo identity were recognized.
 *
 * Uses the existing scanner and publisher in the deployed container.
 * Photos whose price was not confidently parsed remain in review; no
 * invented prices or products for other accounts are ever published.
 */
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { links } from './mama-public-album-links.mjs'
import { remainingMamaAlbums, mamaFolderSlug } from './mama-import-remaining-plan.mjs'
import { ensureCatalogSchema } from '../server/catalog-features-hooks.mjs'
import { ensureScannerSchema, processImportJob, processNormalizationJob } from '../server/scanner-hooks.mjs'
import { collectCatalog } from '../server/scanner-collector.mjs'
import { publishJob } from '../server/scanner-publish-hooks.mjs'
import { prepareReview } from '../server/scanner-review.mjs'
import { MAMA_IMPORT_MARKER, canonicalMamaName, prepareMamaPhoto } from '../server/mama-import-plan.mjs'

const apply = process.argv.includes('--apply')
const publishVerified = process.argv.includes('--publish-verified')
const publishImportable = process.argv.includes('--publish-importable')
const remainingOnly = process.argv.includes('--remaining')
const reviewOnly = !publishVerified && !publishImportable
if(publishVerified&&publishImportable)throw Error('Selecione apenas um modo de publicação.')
if(publishImportable&&(!remainingOnly||!apply))throw Error('Use --apply --remaining --publish-importable para publicar somente os 17 álbuns pendentes.')
const timeoutMs = 12 * 60 * 60 * 1000
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms))
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000})
pool.on('error',e=>console.error('[mama] pool:',e.message))

async function tenantAndCatalog() {
  const names = await pool.query(remainingOnly
    ? "SELECT id,name,slug,plan_tier FROM stores WHERE slug='mama-acessorios'"
    : "SELECT id,name,slug,plan_tier FROM stores WHERE lower(name) LIKE '%mama%'")
  const matches = names.rows.filter(s=>remainingOnly
    ? s.slug==='mama-acessorios' && canonicalMamaName(s.name).startsWith('mama ')
    : canonicalMamaName(s.name)==='mama acessorios')
  if(matches.length!==1)throw Error('Conta MAMA de destino não encontrada de maneira inequívoca; encontradas: '+matches.length)
  const store=matches[0]
  const catalogs=await pool.query('SELECT id,name FROM catalogs WHERE store_id=$1 AND is_default=true AND active=true',[store.id])
  if(catalogs.rowCount!==1)throw Error('Catálogo padrão da Mama inexistente ou ambíguo.')
  const plans=await pool.query('SELECT product_limit FROM platform_plans WHERE code=$1 AND active=true',[store.plan_tier])
  if(plans.rowCount!==1)throw Error('Plano da Mama sem configuração de limites.')
  return {store,catalog:catalogs.rows[0],limit:plans.rows[0].product_limit}
}

async function ensureMamaFolder(store,displayName) {
  if(store.plan_tier!=='ouro')throw Error('A conta da Mama deve ter plano Ouro para criar pastas adicionais.')
  const slug=mamaFolderSlug(displayName)
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['mama-folder:'+store.id+':'+slug])
    let existing=await client.query('SELECT id,name,slug FROM catalogs WHERE store_id=$1 AND slug=$2',[store.id,slug])
    if(existing.rowCount){
      if(canonicalMamaName(existing.rows[0].name)!==canonicalMamaName(displayName))throw Error('Existe uma pasta com slug conflitante: '+slug)
      await client.query('COMMIT')
      return {...existing.rows[0],reused:true}
    }
    const created=await client.query(
      "INSERT INTO catalogs(id,store_id,slug,name,kind,price_mode,is_default,active,explicit_membership) VALUES($1,$2,$3,$4,'varejo','base',false,true,true) RETURNING id,name,slug",
      [crypto.randomUUID(),store.id,slug,displayName],
    )
    await client.query('COMMIT')
    return {...created.rows[0],reused:false}
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}

async function linkPreviouslyPublished(storeId,url,catalogId) {
  const found=await pool.query(
    "SELECT id FROM import_jobs WHERE store_id=$1 AND source_url=$2 AND status='completed' ORDER BY created_at DESC LIMIT 1",
    [storeId,url],
  )
  if(!found.rowCount)return null
  const jobId=found.rows[0].id
  const productIds=await pool.query(
    `SELECT DISTINCT n.published_product_id AS product_id FROM import_normalized_products n
     JOIN products p ON p.id=n.published_product_id AND p.store_id=$1
     WHERE n.job_id=$2 AND n.store_id=$1 AND n.published_product_id IS NOT NULL`,
    [storeId,jobId],
  )
  if(!productIds.rowCount)return null
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO catalog_products(catalog_id,product_id,price_override,visible)
       SELECT $1,ids.product_id,NULL,true FROM unnest($2::text[]) AS ids(product_id)
       ON CONFLICT(catalog_id,product_id) DO UPDATE SET visible=true,updated_at=now()`,
      [catalogId,productIds.rows.map(x=>x.product_id)],
    )
    await client.query('COMMIT')
    return {jobId,linked:productIds.rowCount}
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
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
      if(Number(result.skipped||0)>0){
        if(!publishImportable)throw Error('Álbum incompleto: '+result.skipped+' foto(s) sem download.')
        console.warn('[mama] coleta parcial:',result.skipped,'foto(s) ignoradas; somente as disponíveis serão importadas.')
      }
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

async function selectPricedPhotos(jobId,storeId,album,url,visualDecisions,{skipUnstable=false}={}) {
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
    if (!/^[A-Za-z0-9_-]{22}$/.test(photoKey)) {
      if(skipUnstable){
        if(row.selected)await pool.query(
          'UPDATE import_normalized_products SET selected=false,updated_at=now() WHERE id=$1 AND job_id=$2 AND store_id=$3',
          [row.id,jobId,storeId],
        )
        unresolved++;continue
      }
      throw Error('Job antigo ou foto sem identidade estável: '+jobId+'. Recapture o álbum antes de publicar.')
    }
    if(row.review_data) {
      const saved=prepareMamaPhoto({album,albumUrl:url,candidate:row.candidate,
        normalized:row.review_data,requireStableIdentity:true})
      if(row.selected && /^MAMA-[A-F0-9]{22}$/.test(String(row.review_data.sku||'')) && saved.eligible &&
        prepareReview(saved.data).publishable){
        priced++
      }else {
        // Existing manually edited values are never overwritten, but incomplete
        // rows must not enter the merchant's public catalog.
        if(skipUnstable && row.selected){
          await pool.query('UPDATE import_normalized_products SET selected=false,updated_at=now() WHERE id=$1 AND job_id=$2 AND store_id=$3',[row.id,jobId,storeId])
        }
        protectedEdits++
      }
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
  if(remainingOnly)await ensureCatalogSchema()
  const {store,catalog,limit}=await tenantAndCatalog()
  const albums=remainingOnly?remainingMamaAlbums():links.map(([name,url])=>({name,url,displayName:name}))
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
    albumCount:albums.length,mode:!apply?'preview':publishVerified?'publish_verified':publishImportable?'publish_importable':'collect_for_visual_review',
  }))
  if(!apply) {
    console.log('[mama] Prévia apenas. Para importar pendentes: node scripts/import-mama-once.mjs --apply --remaining --publish-importable')
    for(const album of albums)console.log('[mama] pasta planejada',JSON.stringify(album))
    return
  }
  const summary=[]
  for(let i=0;i<albums.length;i++) {
    const {name:album,url,displayName}=albums[i]
    console.log('[mama] álbum',JSON.stringify({number:i+1,of:albums.length,album,displayName}))
    let jobId=''
    try {
      const target=remainingOnly?await ensureMamaFolder(store,displayName):catalog
      if(remainingOnly){
        const previous=await linkPreviouslyPublished(store.id,url,target.id)
        if(previous){summary.push({album,folder:target.name,status:'linked_previous',...previous});continue}
      }
      const job=await jobFor(store.id,url)
      jobId=job.id
      const ready=await stageAlbum(job)
      if(ready.status==='completed') {
        const previous=remainingOnly?await linkPreviouslyPublished(store.id,url,target.id):null
        summary.push({album,jobId,folder:target.name,status:previous?'linked_previous':'already_completed',linked:previous?.linked||0})
        continue
      }
      const review=await selectPricedPhotos(jobId,store.id,album,url,visualDecisions,{skipUnstable:publishImportable})
      const record={album,folder:target.name,jobId,...review}
      if(reviewOnly)record.status='review_ready'
      else if(!publishImportable && (review.unresolved>0 || review.protectedEdits>0))throw Error('Há '+review.unresolved+' foto(s) sem decisão visual e '+review.protectedEdits+' edição(ões) prévias. Publicação bloqueada até concluir a conferência.')
      else if(review.priced===0)record.status='no_confirmed_prices'
      else {
        record.toCreate=await ensureRoom(store.id,limit,jobId)
        record.pendingReviewJobId=await preserveUnpricedForReview(jobId,store.id,url)
        const result=await publish(jobId,store.id,target.id)
        record.status='published'
        record.created=result.created
        record.skippedExisting=result.skipped_existing
      }
      summary.push(record)
      console.log('[mama] resultado',JSON.stringify(record))
    } catch(e) {
      const failed={album,displayName,jobId,status:'requires_attention',error:String(e.message||e).slice(0,300)}
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
