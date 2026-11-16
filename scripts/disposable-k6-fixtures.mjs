import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import pg from 'pg'
const api=new URL(process.env.BASE_URL||'http://127.0.0.1:3000')
const db=new URL(process.env.DATABASE_URL||'postgresql://bad:bad@invalid/invalid')
const isLocal=s=>['127.0.0.1','localhost','[::1]'].includes(s)
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.ok(isLocal(api.hostname)&&isLocal(db.hostname)&&/_perf$/.test(db.pathname))
const pool=new pg.Pool({connectionString:db.toString(),max:3})
const stores=[],prefix='k6'+crypto.randomBytes(3).toString('hex')
async function call(url,options={}){
 const res=await fetch(new URL(url,api),{
  ...options,headers:{'content-type':'application/json',...(options.headers||{})},
 })
 return {status:res.status,data:await res.json().catch(()=>({})),cookies:res.headers.getSetCookie?.()||[]}
}
try{
 for(let i=0;i<20;i++){
  const name=prefix+'-loja-'+i
  const signup=await call('/api/auth/register',{method:'POST',body:JSON.stringify({
   name:'Lab synthetic '+i,email:name+'@example.test',password:'lab-password-123456',
   storeName:name,whatsapp:'5511999999999',planCode:'ouro',
  })})
  assert.equal(signup.status,201,JSON.stringify({status:signup.status,error:signup.data.error}))
  const cookie=(signup.cookies.find(x=>/^(atacado_session|shopvax_session)=/.test(x))||'').split(';')[0]
  assert.ok(cookie)
  const home=await call('/api/admin/bootstrap?compact=1',{headers:{Cookie:cookie}})
  assert.equal(home.status,200)
  const storeId=home.data.store.id
  await pool.query('UPDATE stores SET minimum_order=0,is_active=true WHERE id=$1',[storeId])
  await pool.query(
   "INSERT INTO products(id,store_id,sku,name,description,price,category,active) SELECT $1 || '-p-' || n,$2,'K6-'||n,'Produto teste '||n,'Somente laboratório',19.9,'Teste',true FROM generate_series(1,150) n",
   [name,storeId])
  const products=await pool.query('SELECT id FROM products WHERE store_id=$1 ORDER BY id LIMIT 1',[storeId])
  await pool.query("INSERT INTO sellers(id,store_id,slug,name,phone,is_active) VALUES ($1,$2,'operador','Operador fictício','5511999999999',true)",[crypto.randomUUID(),storeId])
  await pool.query("INSERT INTO orders(id,code,store_id,total,items,status) SELECT $1||'-order-'||n,$1||'-code-'||n,$2,19.9,'[]'::jsonb,'whatsapp' FROM generate_series(1,50)n",[name,storeId])
  stores.push({slug:signup.data.storeSlug,cookie,productId:products.rows[0].id})
 }
 await pool.query('ANALYZE products')
 await writeFile('/tmp/shopvax-k6-fixtures.json',JSON.stringify({stores}))
 console.log('K6_FIXTURES_READY '+JSON.stringify({stores:stores.length,products:3000,orders:1000}))
}finally{await pool.end()}
