import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import pg from 'pg'
import sharp from 'sharp'
const server=new URL(process.env.BASE_URL||'')
const database=new URL(process.env.DATABASE_URL||'')
const safe=h=>['127.0.0.1','localhost','[::1]'].includes(h)
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.ok(safe(server.hostname)&&safe(database.hostname)&&database.pathname.endsWith('_perf'))
const pool=new pg.Pool({connectionString:database.href,max:4,connectionTimeoutMillis:7000})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const stores=[],prefix='journey'+crypto.randomBytes(3).toString('hex')
async function q(text,args=[]){
 for(let retry=0;retry<18;retry++){
  try{return await pool.query(text,args)}
  catch(err){
   if(!['40P01','55P03','42P01','42703'].includes(err.code)||retry===17)throw err
   await wait(280*(retry+1))
  }
 }
}
async function api(endpoint,opt={}){
 const resp=await fetch(new URL(endpoint,server),{
  ...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})},
  signal:AbortSignal.timeout(18000),
 })
 const data=await resp.json().catch(()=>({}))
 return {status:resp.status,body:data,cookies:resp.headers.getSetCookie?.()||[],labBypass:resp.headers.get('x-lab-rate-bypass')}
}
try{
 await mkdir('dist/lab-media',{recursive:true})
 const palette=['#c6cbe9','#b9d7bc','#f0c4bd','#e5dbb5','#c6dcdf','#d6c9f0','#ecdbce','#bad3e0','#e7cbda','#e9e1d0','#b6cfc1','#e7c6c4']
 for(let k=0;k<12;k++){
  const img=await sharp({create:{width:520,height:680,channels:3,background:palette[k]}})
   .jpeg({quality:74}).toBuffer()
  await writeFile('dist/lab-media/product-'+k+'.jpg',img)
 }
 for(let i=0;i<60;i++){
  const v=await q("SELECT to_regclass('public.products') AS products,to_regclass('public.orders') AS orders")
  if(v.rows[0]?.products&&v.rows[0]?.orders)break
  await wait(500)
 }
 for(let i=0;i<20;i++){
  const name=prefix+'-'+String(i).padStart(2,'0')
  const signup=await api('/api/auth/register',{method:'POST',body:JSON.stringify({
   name:'Cliente de laboratório '+i,email:name+'@example.test',password:'only-temporary-lab-2026!',
   storeName:name,whatsapp:'5511000000000',planCode:'ouro',
  })})
  assert.equal(signup.status,201,JSON.stringify({stage:'register',i,status:signup.status,error:signup.body.error}))
  const cookie=(signup.cookies.find(x=>/^(atacado_session|shopvax_session)=/.test(x))||'').split(';')[0]
  assert.ok(cookie,'Missing merchant cookie')
  const home=await api('/api/admin/bootstrap?compact=1',{headers:{Cookie:cookie}})
  assert.equal(home.status,200,JSON.stringify({stage:'bootstrap',i,status:home.status,error:home.body.error}))
  const storeId=home.body.store?.id
  assert.ok(storeId)
  await q('UPDATE stores SET minimum_order=0,is_active=true WHERE id=$1',[storeId])
  await q("INSERT INTO sellers(id,store_id,slug,name,phone,is_active) VALUES ($1,$2,'vendedora','Atendimento de teste','5511000000000',true)",[crypto.randomUUID(),storeId])
  const productSql=[
   'INSERT INTO products(id,store_id,sku,name,description,price,category,media_url,media_type,images,active)',
   "SELECT $1||'-p-'||n,$2,'LAB-'||n,'Produto de teste '||n,'Apenas simulação descartável',",
   "15.0+(n%8)*5, CASE n%5 WHEN 0 THEN 'Brincos' WHEN 1 THEN 'Colares'",
   "WHEN 2 THEN 'Pulseiras' WHEN 3 THEN 'Bolsas' ELSE 'Acessórios' END,",
   "'/lab-media/product-'||(n%12)||'.jpg','image',",
   "to_jsonb(ARRAY['/lab-media/product-'||(n%12)||'.jpg']),true",
   'FROM generate_series(1,150) AS n',
  ].join(' ')
  await q(productSql,[name,storeId])
  stores.push({slug:signup.body.storeSlug,cookie,storeId})
 }
 const probe={}
 for(let i=0;i<65;i++){
  const x=await api('/api/public/store/'+encodeURIComponent(stores[0].slug)+'?limit=18')
  if(i===0)assert.equal(x.labBypass,'1','patched local public-store handler did not load; cannot test rate-unlimited throughput')
  probe[x.status]=(probe[x.status]||0)+1
  if(i===0||i===44||i===64){
   console.log('JOURNEY_PROBE '+JSON.stringify({index:i+1,status:x.status,error:x.body.error||'',hasProducts:Array.isArray(x.body.products),hasMore:x.body.page?.hasMore}))
  }
 }
 console.log('JOURNEY_RATE_SUMMARY '+JSON.stringify(probe))
 assert.equal(probe[200],65,'Single-IP protection still active: refusing misleading 2k VU results.')
 const catalog=await api('/api/public/store/'+encodeURIComponent(stores[0].slug)+'?limit=18')
 const products=catalog.body.products
 assert.ok(products?.length===18&&catalog.body.page?.nextCursor)
 const publicCookie=(catalog.cookies.find(x=>x.startsWith('atacado_public='))||'').split(';')[0]
 assert.ok(publicCookie,'Visitor cookie missing from initial page')
 const next=await api('/api/public/store/'+encodeURIComponent(stores[0].slug)+
  '?limit=18&compactPage=1&cursor='+encodeURIComponent(catalog.body.page.nextCursor),{headers:{Cookie:publicCookie}})
 assert.equal(next.status,200)
 assert.ok(next.body.products?.length>0&&next.body.products[0].id!==products[0].id)
 const checkout=await api('/api/business/orders',{method:'POST',
   body:JSON.stringify({storeSlug:stores[0].slug,sellerSlug:'vendedora',
    buyer:{name:'Comprador de teste',city:'Salvador',cep:'40000000',phone:'5511999999999'},
    notes:'Simulação de teste, não enviar pelo WhatsApp',
    items:[{productId:products[0].id,quantity:1,selections:{}},{productId:products[1].id,quantity:2,selections:{}}]})})
 assert.equal(checkout.status,201,JSON.stringify({stage:'checkout',status:checkout.status,error:checkout.body.error}))
 assert.ok(checkout.body.orderId&&checkout.body.code)
 assert.ok(checkout.body.whatsappUrl?.startsWith('https://wa.me/5511000000000?text='))
 const msg=decodeURIComponent(checkout.body.whatsappUrl.split('?text=')[1])
 assert.ok(msg.includes(products[0].name)&&msg.includes(products[1].name)&&msg.includes(checkout.body.code))
 console.log('JOURNEY_CHECKOUT_PROBE '+JSON.stringify({status:checkout.status,orderId:checkout.body.orderId,
  whatsappUrlOnly:true,messageContainsProducts:true,noWhatsappRequest:true}))
 await q('ANALYZE products')
 await writeFile('/tmp/shopvax-real-buyer-fixtures.json',JSON.stringify({stores}))
 console.log('JOURNEY_FIXTURES_READY '+JSON.stringify({stores:stores.length,products:3000,mediaFiles:12,checkoutProbe:1}))
}finally{await pool.end()}
