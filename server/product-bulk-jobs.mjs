import crypto from 'node:crypto'

// Durable and tenant-scoped bulk work. HTTP requests only enqueue a bounded job;
// the worker deletes/removes small batches to avoid proxy timeouts on 100k+ rows.
export function installProductBulkJobs(app,pool,auth,asyncRoute){
  let schemaPromise
  const ensure=()=>{
    if(!schemaPromise)schemaPromise=pool.query(`
      CREATE TABLE IF NOT EXISTS product_bulk_jobs (
        id text PRIMARY KEY,
        store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode text NOT NULL CHECK(mode IN ('delete-products','remove-members')),
        catalog_id text,
        search_query text NOT NULL DEFAULT '',
        category text NOT NULL DEFAULT '',
        excluded_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        cutoff_at timestamptz NOT NULL DEFAULT now(),
        total bigint NOT NULL DEFAULT 0,
        processed bigint NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_bulk_jobs_store_created ON product_bulk_jobs(store_id,created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_jobs_active_store ON product_bulk_jobs(store_id)
      WHERE status IN ('queued','running');
    `).catch(err=>{schemaPromise=null;throw err})
    return schemaPromise
  }
  const getStore=async req=>{
    const r=await pool.query('SELECT id,plan_tier FROM stores WHERE owner_id=$1 LIMIT 1',[req.user.id])
    return r.rows[0]||null
  }
  const readJob=async (id,storeId)=>{
    const r=await pool.query('SELECT * FROM product_bulk_jobs WHERE id=$1 AND store_id=$2',[id,storeId])
    return r.rows[0]||null
  }
  const shape=job=>({
    id:job.id,mode:job.mode,catalogId:job.catalog_id||null,
    status:job.status,total:Number(job.total),processed:Number(job.processed),
    error:job.error||null,createdAt:job.created_at,finishedAt:job.completed_at,
  })
  const lockKey=id=>{
    const a=BigInt('0x'+crypto.createHash('sha256').update(id).digest('hex').slice(0,16))
    return BigInt.asIntN(64,a).toString()
  }
  function matcher(job,catalog){
    const excludeJson=typeof job.excluded_ids==='string'?job.excluded_ids:JSON.stringify(job.excluded_ids||[])
    const params=[job.store_id,job.cutoff_at,job.search_query,job.category,excludeJson]
    const cond=[
      'p.store_id=$1',
      'p.created_at<=$2::timestamptz',
      "($3::text='' OR position($3 IN lower(p.name || ' ' || p.sku || ' ' || p.category))>0)",
      "($4::text='' OR p.category=$4)",
      "NOT(p.id=ANY(SELECT jsonb_array_elements_text($5::jsonb)))",
    ]
    if(catalog){
      params.push(catalog.id)
      const id='$'+params.length
      cond.push(catalog.explicit_membership
        ? `EXISTS(SELECT 1 FROM catalog_products cp WHERE cp.catalog_id=${id} AND cp.product_id=p.id AND cp.visible=true)`
        : `NOT EXISTS(SELECT 1 FROM catalog_products cp WHERE cp.catalog_id=${id} AND cp.product_id=p.id AND cp.visible=false)`)
    }
    return {params,where:cond.join(' AND ')}
  }
  async function processJob(id){
    const client=await pool.connect()
    const key=lockKey(id)
    let locked=false
    try{
      const lock=await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok',[key])
      if(!lock.rows[0]?.ok)return
      locked=true
      let row=(await client.query('SELECT * FROM product_bulk_jobs WHERE id=$1',[id])).rows[0]
      if(!row||!['queued','running'].includes(row.status))return
      const cat=row.catalog_id
        ? (await client.query('SELECT id,store_id,is_default,explicit_membership FROM catalogs WHERE id=$1 AND store_id=$2',[row.catalog_id,row.store_id])).rows[0]
        : null
      if(row.catalog_id&&!cat)throw Error('O catálogo foi excluído durante a operação.')
      const store=(await client.query('SELECT plan_tier FROM stores WHERE id=$1',[row.store_id])).rows[0]
      if(cat&&!cat.is_default&&store?.plan_tier!=='ouro')throw Error('Catálogo bloqueado: plano Gold necessário.')
      const {params,where}=matcher(row,cat)
      await client.query("UPDATE product_bulk_jobs SET status='running',updated_at=now() WHERE id=$1",[id])
      for(;;){
        let result
        if(row.mode==='delete-products'){
          result=await client.query(`
            WITH todo AS (SELECT p.id FROM products p WHERE ${where} ORDER BY p.id LIMIT 300)
            DELETE FROM products p USING todo WHERE p.id=todo.id AND p.store_id=$1
            RETURNING p.id`,params)
        }else if(cat.explicit_membership){
          result=await client.query(`
            WITH todo AS (SELECT p.id FROM products p WHERE ${where} ORDER BY p.id LIMIT 400)
            DELETE FROM catalog_products cp USING todo WHERE cp.catalog_id=$6 AND cp.product_id=todo.id
            RETURNING cp.product_id`,params)
        }else{
          result=await client.query(`
            WITH todo AS (SELECT p.id FROM products p WHERE ${where} ORDER BY p.id LIMIT 300)
            INSERT INTO catalog_products(catalog_id,product_id,visible)
            SELECT $6,todo.id,false FROM todo
            ON CONFLICT(catalog_id,product_id)
            DO UPDATE SET visible=false,updated_at=now()
            RETURNING product_id`,params)
        }
        if(result.rowCount){
          await client.query('UPDATE product_bulk_jobs SET processed=processed+$2,updated_at=now() WHERE id=$1',[id,result.rowCount])
        }
        if(!result.rowCount)break
        await new Promise(resolve=>setImmediate(resolve))
      }
      await client.query("UPDATE product_bulk_jobs SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1",[id])
    }catch(error){
      console.error('[product bulk job]',id,error?.message||error)
      await client.query("UPDATE product_bulk_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1",[id,String(error?.message||'Erro na exclusão').slice(0,500)]).catch(()=>{})
    }finally{
      if(locked)await client.query('SELECT pg_advisory_unlock($1::bigint)',[key]).catch(()=>{})
      client.release()
    }
  }
  let resuming=false
  const resume=async()=>{
    if(resuming)return
    resuming=true
    try{
      await ensure()
      const pending=await pool.query("SELECT id FROM product_bulk_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 20")
      for(const row of pending.rows)void processJob(row.id)
    }catch(error){console.warn('[product bulk resume]',error?.message||error)}
    finally{resuming=false}
  }
  const timer=setInterval(()=>{void resume()},60000)
  timer.unref?.()

  app.post('/api/admin/products/bulk-jobs',auth,asyncRoute(async(req,res)=>{
    await ensure()
    const store=await getStore(req)
    if(!store)return res.status(404).json({error:'Loja não encontrada.'})
    const mode=String(req.body?.mode||'')
    if(!['delete-products','remove-members'].includes(mode))return res.status(400).json({error:'Ação inválida.'})
    const query=String(req.body?.q||'').trim().toLowerCase().slice(0,120)
    const category=String(req.body?.category||'').trim().slice(0,80)
    const id=String(req.body?.catalogId||'').trim().slice(0,100)
    const rawExclude=req.body?.excludeIds
    if(rawExclude!==undefined&&(!Array.isArray(rawExclude)||rawExclude.length>500))
      return res.status(400).json({error:'Exclusões individuais excedem o limite.'})
    const exclude=[...new Set((rawExclude||[]).map(x=>String(x||'').trim()).filter(Boolean))]
    if(exclude.some(x=>x.length>100))return res.status(400).json({error:'ID inválido.'})
    let cat=null
    if(id){
      const result=await pool.query('SELECT * FROM catalogs WHERE id=$1 AND store_id=$2',[id,store.id])
      if(!result.rowCount)return res.status(404).json({error:'Catálogo não encontrado.'})
      cat=result.rows[0]
      if(!cat.is_default&&store.plan_tier!=='ouro')
        return res.status(403).json({error:'Catálogo exige plano Gold.',code:'GOLD_REQUIRED'})
    }
    if(mode==='remove-members'&&(!cat||cat.is_default))return res.status(400).json({error:'Escolha um catálogo adicional para remover itens sem apagá-los da loja.'})
    // A exclusão global total precisa de uma frase mais forte e não deve herdar filtros.
    const fullDelete=mode==='delete-products'&&!query&&!category&&!id&&!exclude.length
    const required=fullDelete?'EXCLUIR TUDO':mode==='remove-members'?'ESVAZIAR CATÁLOGO':'EXCLUIR SELEÇÃO'
    if(req.body?.confirmation!==required)return res.status(400).json({error:'Confirmação inválida.',required})
    const expected=Number(req.body?.expectedTotal)
    if(!Number.isSafeInteger(expected)||expected<1)return res.status(400).json({error:'Quantidade inválida.'})
    const active=await pool.query("SELECT id FROM product_bulk_jobs WHERE store_id=$1 AND status IN ('queued','running') LIMIT 1",[store.id])
    if(active.rowCount)return res.status(409).json({error:'Já existe uma exclusão em andamento.',jobId:active.rows[0].id})
    const jobId=crypto.randomUUID()
    const cutoff=new Date()
    const job={store_id:store.id,cutoff_at:cutoff,search_query:query,category,excluded_ids:JSON.stringify(exclude)}
    const matched=matcher(job,cat)
    const count=await pool.query('SELECT count(*)::int AS total FROM products p WHERE '+matched.where,matched.params)
    const total=Number(count.rows[0].total)
    if(total!==expected)return res.status(409).json({error:'A lista mudou. Atualize antes de confirmar a exclusão.',total})
    try{
      await pool.query(`INSERT INTO product_bulk_jobs(id,store_id,owner_id,mode,catalog_id,search_query,category,excluded_ids,cutoff_at,total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [jobId,store.id,req.user.id,mode,cat?.id||null,query,category,JSON.stringify(exclude),cutoff,total])
    }catch(error){
      if(error?.code==='23505')return res.status(409).json({error:'Outra exclusão está em andamento.'})
      throw error
    }
    res.status(202).json({job:{id:jobId,total,processed:0,status:'queued',mode,catalogId:cat?.id||null}})
    void processJob(jobId)
  }))

  app.get('/api/admin/products/bulk-jobs/:jobId',auth,asyncRoute(async(req,res)=>{
    await ensure()
    const store=await getStore(req)
    if(!store)return res.status(404).json({error:'Loja não encontrada.'})
    const job=await readJob(String(req.params.jobId||''),store.id)
    if(!job)return res.status(404).json({error:'Operação não encontrada.'})
    res.set('Cache-Control','private, no-store')
    res.json({job:shape(job)})
    if(['queued','running'].includes(job.status))void processJob(job.id)
  }))
}
