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
 assert.equal(account.response.status,503,'Cadastro deve falhar antes de criar uma loja se Stripe estiver indisponível')
 assert.equal(account.payload.code,'BILLING_NOT_CONFIGURED')
 const googleSignup=await req('/api/auth/google','POST',{intent:'register',credential:'teste-sem-configuracao'})
 assert.equal(googleSignup.response.status,503,'Cadastro via Google também fica bloqueado quando Stripe não estiver pronta')
 assert.equal((await pool.query('SELECT id FROM users WHERE email=$1',[email])).rowCount,0,'Não criar conta incompleta sem forma de pagar')
 // Loja já criada anteriormente sem pagamento também não pode entrar no painel.
 userId=crypto.randomUUID()
 const storeId=crypto.randomUUID()
 await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',
  [userId,email,'Teste sem pagamento',null])
 const inserted=await pool.query([
  'INSERT INTO stores(id,owner_id,slug,name,plan_tier,billing_required,signup_plan_selected_at)',
  "VALUES($1,$2,$3,$4,'ouro',true,now()) RETURNING id,slug,plan_tier,billing_required",
 ].join(' '),[storeId,userId,'payment-gate-'+seed,storeName])
 const row=inserted.rows[0]
 assert.equal(row.billing_required,true)
 assert.equal(row.plan_tier,'bronze','Não liberar plano Ouro apenas pela seleção')
 const token=crypto.randomBytes(32).toString('base64url')
 await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
 [crypto.createHash('sha256').update(token).digest('hex'),userId])
 const cookie='atacado_session='+token
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
 if(userId) {
  // O backend ainda pode estar aplicando DDL durante o boot da suíte isolada.
  // Tentar novamente apenas em deadlock transitório, sem mascarar outros erros.
  for(let attempt=0; attempt<5; attempt++){
   try { await pool.query('DELETE FROM users WHERE id=$1',[userId]); break }
   catch(error) {
    if(error?.code!=='40P01'||attempt===4) throw error
    await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)))
   }
  }
 }
 await pool.end()
}
