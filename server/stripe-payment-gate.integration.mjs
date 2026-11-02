import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

const base=process.env.BASE_URL || 'http://127.0.0.1:3000'
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL exigida')
if(process.env.SHOPVAX_TEST_BILLING_BYPASS==='1')throw new Error('O teste real de pagamento nunca pode usar bypass')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const seed=crypto.randomBytes(7).toString('hex')
const email='shopvax-payment-gate-'+seed+'@example.test'
const storeName='Loja pagamento '+seed
let userId=''
const req=async(path,method='GET',body,cookie='')=>{
 const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined})
 const payload=await response.json().catch(()=>null)
 return {response,payload}
}
try{
 const account=await req('/api/auth/register','POST',{
  name:'Teste de Pagamento',email,password:'SenhaDeTeste2026!',storeName,whatsapp:'71999990000',planCode:'ouro',
 })
 assert.equal(account.response.status,201,JSON.stringify(account.payload))
 const setCookie=account.response.headers.get('set-cookie') || ''
 const cookie=setCookie.split(';')[0]
 assert.match(cookie,/(atacado_session|shopvax_session)=/)
 const row=(await pool.query([
  'SELECT u.id AS user_id,s.id AS store_id,s.slug,s.plan_tier,s.billing_required,s.signup_plan_selected_at',
  'FROM users u JOIN stores s ON s.owner_id=u.id WHERE u.email=$1',
 ].join(' '),[email])).rows[0]
 assert(row)
 userId=row.user_id
 assert.equal(row.billing_required,true,'Novos cadastros precisam de assinatura mesmo sem Stripe configurada')
 assert(row.signup_plan_selected_at)
 assert.equal(row.plan_tier,'bronze','Plano Ouro não deve ser ativado apenas no cadastro')
 const status=await req('/api/billing/status','GET',null,cookie)
 assert.equal(status.response.status,200)
 assert.equal(status.payload.required,true)
 assert.equal(status.payload.accessGranted,false)
 for(const url of ['/api/admin/bootstrap','/api/admin/catalogs','/api/admin/phase3']){
  const blocked=await req(url,'GET',null,cookie)
  assert.equal(blocked.response.status,402,url+' deve exigir pagamento, obtido '+blocked.response.status)
  assert.equal(blocked.payload.code,'PAYMENT_REQUIRED')
 }
 const order=await req('/api/business/orders','POST',{storeSlug:row.slug,items:[{productId:'nada',quantity:1,selections:{}}]})
 assert.equal(order.response.status,402,'Não permitir pedido de loja sem assinatura')
 const tryCheckout=await req('/api/billing/checkout','POST',{planCode:'ouro',cycle:'monthly'},cookie)
 assert.equal(tryCheckout.response.status,503,'Quando Stripe estiver indisponível, bloquear e informar erro; não liberar painel')
 const legacy=await pool.query('SELECT subscription_status FROM shopvax_stripe_billing WHERE store_id=$1',[row.store_id])
 assert(legacy.rowCount===0 || legacy.rows[0].subscription_status!=='active')
 console.log('NEW_STORE_PAYMENT_REQUIRED_BACKEND_OK')
}finally{
 if(userId)await pool.query('DELETE FROM users WHERE id=$1',[userId])
 await pool.end()
}
