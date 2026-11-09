import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

const base=process.env.BASE_URL||'http://127.0.0.1:3000'
if(process.env.NODE_ENV!=='test'||!/127\.0\.0\.1|localhost/.test(base)||!/atacado_phase2/.test(process.env.DATABASE_URL||''))
  throw Error('Teste destrutivo somente no banco isolado da fase 2!')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const suffix=crypto.randomBytes(5).toString('hex'),id=()=>crypto.randomUUID()
const users=[]
const hash=x=>crypto.createHash('sha256').update(x).digest('hex')
async function makeStore(plan){
 const userId=id(),storeId=id(),token=crypto.randomBytes(32).toString('base64url')
 await pool.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[userId,'Admin bulk','bulk-'+suffix+'-'+plan+'@example.test','disabled'])
 users.push(userId)
 await pool.query("INSERT INTO stores(id,owner_id,slug,name,plan_tier,billing_required) VALUES($1,$2,$3,$4,$5,false)",[storeId,userId,'bulk-'+suffix+'-'+plan,'Loja bulk '+plan,plan])
 await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[hash(token),userId])
 return {storeId,userId,cookie:'atacado_session='+token}
}
const call=async(store,url,method='GET',data)=>{
 const r=await fetch(base+url,{method,headers:{cookie:store.cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined})
 return {status:r.status,body:await r.json().catch(()=>({}))}
}
const wait=async(store,jobId)=>{
 for(let tries=0;tries<250;tries++){
  const r=await call(store,'/api/admin/products/bulk-jobs/'+jobId)
  assert.equal(r.status,200,'Operação pertence ao lojista')
  if(r.body.job.status==='completed')return r.body.job
  if(r.body.job.status==='failed')throw Error('Bulk job failed: '+JSON.stringify(r.body))
  await new Promise(resolve=>setTimeout(resolve,140))
 }
 throw Error('Job não concluiu durante homologação isolada')
}
try{
 const gold=await makeStore('ouro'),other=await makeStore('bronze')
 await pool.query(`INSERT INTO products(id,store_id,sku,name,price,category)
   SELECT $1||'-'||x::text,$2,'SKU-'||x::text,
     CASE WHEN x<=320 THEN 'Bolsa Azul ' ELSE 'Bolsa Vermelha ' END||x::text,
     20,'Bolsas' FROM generate_series(1,720) x`,['bulk-'+suffix,gold.storeId])
 await pool.query(`INSERT INTO products(id,store_id,sku,name,price,category)
   SELECT $1||'-'||x::text,$2,'SKU-X-'||x::text,'Produto outra loja',20,'Bolsas' FROM generate_series(1,5) x`,
   ['other-'+suffix,other.storeId])
 const catalogs=await call(gold,'/api/admin/catalogs')
 assert.equal(catalogs.status,200)
 const created=await call(gold,'/api/admin/catalogs','POST',{name:'Varejo Seletivo',kind:'varejo',minimumOrder:20})
 assert.equal(created.status,201,JSON.stringify(created.body))
 const retail=created.body.catalog
 assert.equal(retail.explicitMembership,true)
 const empty=await call(gold,'/api/admin/products?catalogId='+retail.id)
 assert.equal(empty.status,200)
 assert.equal(empty.body.pagination.total,0,'Novo catálogo deve iniciar vazio')
 const productIds=Array.from({length:520},(_,i)=>'bulk-'+suffix+'-'+(i+1))
 for(let i=0;i<productIds.length;i+=500){
  const add=await call(gold,'/api/admin/catalogs/'+retail.id+'/members','POST',{ids:productIds.slice(i,i+500),action:'add'})
  assert.equal(add.status,200,'Associação em lotes de até 500')
 }
 const listed=await call(gold,'/api/admin/products?catalogId='+retail.id)
 assert.equal(listed.body.pagination.total,520,'Lista paginada não depende de carregar todos os produtos')
 assert.equal(listed.body.products.length,18)
 assert.equal((await call(other,'/api/admin/products?catalogId='+retail.id)).status,404,'Catálogo isolado por loja')
 const forbidden=await call(gold,'/api/admin/products/bulk-jobs','POST',{
  mode:'remove-members',catalogId:retail.id,expectedTotal:520,confirmation:'EXCLUIR TUDO'})
 assert.equal(forbidden.status,400,'Frase errada é rejeitada')
 const removes=await call(gold,'/api/admin/products/bulk-jobs','POST',{
  mode:'remove-members',catalogId:retail.id,expectedTotal:520,confirmation:'ESVAZIAR CATÁLOGO'})
 assert.equal(removes.status,202,JSON.stringify(removes.body))
 assert.equal((await call(other,'/api/admin/products/bulk-jobs/'+removes.body.job.id)).status,404,'Job isolado por loja')
 const removed=await wait(gold,removes.body.job.id)
 assert.equal(removed.processed,520,'Remoção em mais de um lote')
 assert.equal((await call(gold,'/api/admin/products?catalogId='+retail.id)).body.pagination.total,0)
 assert.equal((await call(gold,'/api/admin/products')).body.pagination.total,720,'Esvaziar catálogo não exclui produtos da loja')
 const queryJob=await call(gold,'/api/admin/products/bulk-jobs','POST',{
  mode:'delete-products',q:'azul',expectedTotal:320,confirmation:'EXCLUIR SELEÇÃO'})
 assert.equal(queryJob.status,202,JSON.stringify(queryJob.body))
 const filtered=await wait(gold,queryJob.body.job.id)
 assert.equal(filtered.processed,320,'Exclusão de todos os resultados filtrados, mesmo não carregados')
 assert.equal((await call(gold,'/api/admin/products')).body.pagination.total,400)
 const stale=await call(gold,'/api/admin/products/bulk-jobs','POST',{
  mode:'delete-products',expectedTotal:401,confirmation:'EXCLUIR TUDO'})
 assert.equal(stale.status,409,'Bloqueia total desatualizado')
 const all=await call(gold,'/api/admin/products/bulk-jobs','POST',{
  mode:'delete-products',expectedTotal:400,confirmation:'EXCLUIR TUDO'})
 assert.equal(all.status,202,JSON.stringify(all.body))
 const finished=await wait(gold,all.body.job.id)
 assert.equal(finished.processed,400)
 assert.equal((await call(gold,'/api/admin/products')).body.pagination.total,0)
 assert.equal((await call(other,'/api/admin/products')).body.pagination.total,5,'Outra loja permanece intacta')
 console.log('SHOPVAX_CATALOG_TABS_BULK_JOBS_PASS')
}finally{
 for(const uid of users.reverse())await pool.query('DELETE FROM users WHERE id=$1',[uid]).catch(()=>{})
 await pool.end()
}
