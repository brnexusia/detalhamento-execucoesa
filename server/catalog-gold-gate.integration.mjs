import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

const base=process.env.BASE_URL||'http://127.0.0.1:3000'
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const suffix=crypto.randomBytes(6).toString('hex')
const users=[]
const hash=x=>crypto.createHash('sha256').update(x).digest('hex')
const id=()=>crypto.randomUUID()
async function makeStore(plan){
 const userId=id(),storeId=id(),token=crypto.randomBytes(32).toString('base64url')
 const email='gold-gate-'+plan+'-'+suffix+'@example.test',slug='gold-gate-'+plan+'-'+suffix
 await pool.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[userId,'Teste '+plan,email,'disabled'])
 users.push(userId)
 await pool.query('INSERT INTO stores(id,owner_id,slug,name,plan_tier,billing_required,minimum_order) VALUES($1,$2,$3,$4,$5,false,400)',[storeId,userId,slug,'Loja '+plan,plan])
 await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",[hash(token),userId])
 return {userId,storeId,slug,cookie:'atacado_session='+token}
}
async function get(path,cookie){return fetch(base+path,{headers:cookie?{cookie}:{}})}
async function post(path,body,cookie,method='POST'){
 return fetch(base+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)})
}
try{
 const bronze=await makeStore('bronze'),silver=await makeStore('prata'),gold=await makeStore('ouro')
 for(const store of [bronze,silver,gold]){
   const response=await get('/api/admin/catalogs',store.cookie)
   assert.equal(response.status,200,'Catálogo principal existe para cada plano')
   const body=await response.json()
   assert.equal(body.catalogs.filter(c=>c.isDefault).length,1)
   assert.equal(body.canCreateMultiple,store===gold)
 }
 for(const store of [bronze,silver]){
   const fail=await post('/api/admin/catalogs',{name:'Varejo',kind:'varejo',minimumOrder:30},store.cookie)
   assert.ok([403,409].includes(fail.status),'Só Gold permite segundo catálogo')
   assert.equal((await (await get('/api/admin/catalogs',store.cookie)).json()).catalogs.length,1)
 }
 let goldCatalogs=(await (await get('/api/admin/catalogs',gold.cookie)).json()).catalogs
 const def=goldCatalogs.find(c=>c.isDefault)
 const renamed=await post('/api/admin/catalogs/'+def.id,{name:'Caixa fechada',kind:'atacado',minimumOrder:60},gold.cookie,'PATCH')
 assert.equal(renamed.status,200,await renamed.text().catch(()=>''),'Gold edita principal com mínimo')
 const created=await post('/api/admin/catalogs',{name:'Varejo',kind:'varejo',minimumOrder:30},gold.cookie)
 assert.equal(created.status,201,await created.text().catch(()=>''),'Gold cria varejo')
 const retail=(await created.json()).catalog
 goldCatalogs=(await (await get('/api/admin/catalogs',gold.cookie)).json()).catalogs
 assert.equal(goldCatalogs.length,2)
 // Os três novos campos não mudam o preço principal e não duplicam produtos.
 const productRes=await post('/api/admin/products',{
   name:'Bolsa teste',sku:'B-GOLD',price:10,retailPrice:20,boxPrice:100,unitsPerBox:5,
   category:'Bolsas',active:true,variations:[],
 },gold.cookie)
 assert.equal(productRes.status,201,await productRes.text().catch(()=>''),'Cadastra produto com preços paralelos')
 const product=(await productRes.json()).product
 assert.equal(Number(product.retail_price),20)
 assert.equal(Number(product.box_price),100)
 assert.equal(Number(product.units_per_box),5)
 const boxPublic=await get('/api/public/store/'+gold.slug+'?catalog='+def.slug)
 assert.equal(boxPublic.status,200,await boxPublic.text().catch(()=>''))
 const boxPayload=await boxPublic.json()
 assert.equal(boxPayload.activeCatalog.kind,'atacado')
 assert.equal(boxPayload.store.minimumOrder,60)
 assert.equal(boxPayload.products[0].price,100,'Vitrine de caixa fechada usa preço correto')
 assert.equal(boxPayload.products[0].unitsPerBox,5)
 const retailPublic=await get('/api/public/store/'+gold.slug+'?catalog='+retail.slug)
 assert.equal(retailPublic.status,200)
 const retailPayload=await retailPublic.json()
 assert.equal(retailPayload.activeCatalog.kind,'varejo')
 assert.equal(retailPayload.store.minimumOrder,30)
 assert.equal(retailPayload.products[0].price,20,'Vitrine varejo usa preço próprio')
 // O mínimo deve ser verificado no backend, inclusive com link por catálogo.
 const underMinimum=await post('/api/business/orders',{storeSlug:gold.slug,catalogSlug:retail.slug,items:[{productId:product.id,quantity:1,selections:{}}]},'')
 assert.equal(underMinimum.status,400,'Pedido de varejo abaixo do mínimo não pode finalizar')
 const pdf=await get('/api/admin/catalogs/'+retail.id+'/pdf?category=Bolsas',gold.cookie)
 assert.equal(pdf.status,200,'PDF por categoria disponível no catálogo correto')
 assert.match(pdf.headers.get('content-type')||'',/application\/pdf/)
 assert.match(pdf.headers.get('content-disposition')||'',/varejo-bolsas/)
 assert.ok((await pdf.arrayBuffer()).byteLength>800,'PDF não pode estar vazio')
 // Após downgrade, preservar dados e impedir o uso do catálogo adicional.
 await pool.query("UPDATE stores SET plan_tier='prata' WHERE id=$1",[gold.storeId])
 const after=(await (await get('/api/admin/catalogs',gold.cookie)).json()).catalogs
 assert.equal(after.length,2,'Nenhum catálogo antigo é apagado')
 assert.equal(after.find(c=>c.id===retail.id).lockedByPlan,true)
 assert.equal((await get('/api/public/store/'+gold.slug+'?catalog='+retail.slug)).status,404,'Varejo bloqueado publicamente')
 assert.equal((await get('/api/admin/catalogs/'+retail.id+'/pdf',gold.cookie)).status,403,'PDF extra bloqueado')
 assert.equal((await post('/api/business/orders',{storeSlug:gold.slug,catalogSlug:retail.slug,items:[{productId:product.id,quantity:2,selections:{}}]},'')).status,404,'Carrinho extra bloqueado')
 assert.ok([403,409].includes((await post('/api/admin/catalogs',{name:'Terceiro catálogo',kind:'varejo'},gold.cookie)).status))
 await pool.query("UPDATE stores SET plan_tier='ouro' WHERE id=$1",[gold.storeId])
 assert.equal((await get('/api/public/store/'+gold.slug+'?catalog='+retail.slug)).status,200,'Upgrade reativa catálogo preservado')
 console.log('CATALOG_GOLD_GATE_PRICES_PDF_OK')
}finally{
 for(const userId of users.reverse())await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>undefined)
 await pool.end()
}
