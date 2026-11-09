import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

// Integração exclusivamente contra o banco PostgreSQL efêmero do CI.
if(process.env.NODE_ENV!=='test'||!/127\.0\.0\.1|localhost/.test(process.env.BASE_URL||'')||
  !/atacado_phase2/.test(process.env.DATABASE_URL||'')){
 throw Error('Este teste deve rodar apenas no ambiente isolado da fase 2.')
}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const base=process.env.BASE_URL
const suffix=crypto.randomBytes(5).toString('hex')
const id=()=>crypto.randomUUID()
const owner=id(),storeId=id(),productId=id(),slug='buyer-discovery-'+suffix
async function get(path){const r=await fetch(base+path);return {status:r.status,body:await r.json().catch(()=>null)}}
try{
 await pool.query("INSERT INTO users(id,name,email,password_hash) VALUES ($1,'Comprador Teste',$2,'disabled')",[owner,'discovery-'+suffix+'@example.test'])
 await pool.query(`INSERT INTO stores(id,owner_id,slug,name,plan_tier,social_enabled,billing_required,is_active)
  VALUES($1,$2,$3,$4,'bronze',true,false,true)`,[storeId,owner,slug,'Loja Busca '+suffix])
 await pool.query(`INSERT INTO products(id,store_id,sku,name,description,price,category,social_published,active)
  VALUES($1,$2,$3,$4,'Teste de pesquisa',29.9,'Acessórios',true,true)`,[productId,storeId,'BUSCA-'+suffix,'Bolsa Busca '+suffix])
 let response=await get('/api/social/discover?q='+encodeURIComponent(suffix))
 assert.equal(response.status,200,'Pesquisa global deve existir')
 assert.equal(response.body.products.length,1,'Produto encontrado por nome sem acesso ao painel de loja')
 assert.equal(response.body.products[0].id,productId)
 assert.equal(response.body.products[0].store.slug,slug)
 assert.equal(Object.hasOwn(response.body.products[0],'price'),false,'Pesquisa anônima nunca revela preços')
 assert.ok(response.body.categories.includes('Acessórios'))
 response=await get('/api/social/discover?q='+encodeURIComponent('Loja Busca '+suffix))
 assert.equal(response.status,200)
 assert.ok(response.body.stores.some(s=>s.slug===slug),'Loja pesquisável por nome')
 response=await get('/api/social/discover?q='+encodeURIComponent('Bolsa  '+suffix))
 assert.ok(response.body.products.some(p=>p.id===productId),'Pesquisa separada por palavras encontra o produto')
 response=await get('/api/social/discover?q='+encodeURIComponent(slug))
 assert.ok(response.body.stores.some(s=>s.slug===slug),'Busca a loja pelo slug')
 assert.ok(response.body.products.some(p=>p.id===productId),'Busca produtos da loja pelo slug')
 response=await get('/api/social/discover?q='+encodeURIComponent('BUSCA-'+suffix))
 assert.ok(response.body.products.some(p=>p.id===productId),'Busca o produto pelo SKU')
 response=await get('/api/social/discover?category='+encodeURIComponent('Categoria inexistente '+suffix))
 assert.equal(response.status,200)
 assert.equal(response.body.products.length,0,'Filtra pela categoria')
 response=await get('/api/social/discover?mode=invalido')
 assert.equal(response.status,400,'Valida modalidade')
 response=await get('/api/social/discover?minPrice=10')
 assert.equal(response.status,401,'Filtro de preço exige comprador identificado')
 response=await get('/api/social/buyer/orders')
 assert.equal(response.status,401,'Histórico protegido')
 response=await get('/api/social/buyer/saved')
 assert.equal(response.status,401,'Salvos privados protegidos')
 response=await get('/api/social/stores/'+slug+'/products/'+productId)
 assert.equal(response.status,200)
 assert.equal(response.body.product.price,null,'Rota legada social não revela preço')
 console.log('SHOPVAX_BUYER_DISCOVERY_GUEST_PRIVACY_PASS')
}finally{
 await pool.query('DELETE FROM users WHERE id=$1',[owner]).catch(()=>undefined)
 await pool.end()
}
