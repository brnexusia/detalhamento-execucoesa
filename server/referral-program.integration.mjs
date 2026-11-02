import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { ensureReferralSchema,lookupReferral,captureReferral,qualifyReferralOnPaidInvoice,applyMerchantStripeCredits,reverseReferralForRefund } from './referral-program-core.mjs'
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
const seed=crypto.randomBytes(7).toString('hex')
const users=[]
const makeUser=async(suffix)=>{
 const userId=crypto.randomUUID(),storeId=crypto.randomUUID()
 await pool.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[userId,'Grupo2 '+suffix,'grp2-'+suffix+'-'+seed+'@example.test','disabled'])
 users.push(userId)
 await pool.query("INSERT INTO stores(id,owner_id,slug,name,referral_code) VALUES($1,$2,$3,$4,$5)",[storeId,userId,'grp2-'+suffix+'-'+seed,'Loja '+suffix,suffix==='indicadora'?'SVX-'+seed.toUpperCase():''])
 return {userId,storeId}
}
const fakeCalls=[]
const fakeStripe=async(method,path,fields,key)=>{
 fakeCalls.push({method,path,fields,key})
 return {id:'cbtxn_'+crypto.createHash('sha256').update(key).digest('hex').slice(0,18)}
}
const invoice='in_grupo2_'+seed
try{
 await ensureReferralSchema()
 const indicadora=await makeUser('indicadora')
 const indicada=await makeUser('indicada')
 const code='SVX-'+seed.toUpperCase()
 const resolved=await lookupReferral(pool,code)
 assert.equal(resolved.type,'merchant')
 assert.equal((await captureReferral(indicadora.storeId,code)).ok,false,'Não permite autoindicação')
 const pending=await captureReferral(indicada.storeId,code)
 assert.equal(pending.ok,true)
 assert.equal(pending.status,'pending')
 assert.equal((await pool.query('SELECT billing_credit_months FROM stores WHERE id=$1',[indicadora.storeId])).rows[0].billing_credit_months,0,'Cadastro não dá crédito')
 assert.equal((await captureReferral(indicada.storeId,'SVX-OUTRO')).ok,false,'Código não pode ser substituído por terceiro')
 await pool.query([
  "INSERT INTO shopvax_stripe_billing (store_id,stripe_mode,customer_id,subscription_id,subscription_status,active_plan_code,cycle,paid_until)",
  "VALUES ($1,'test',$2,$3,'active','bronze','monthly',now()+interval '1 month')",
 ].join(' '),[indicadora.storeId,'cus_grp2_'+seed,'sub_grp2_'+seed])
 const client=await pool.connect()
 try{
  await client.query('BEGIN')
  await qualifyReferralOnPaidInvoice(client,indicada.storeId,invoice)
  await qualifyReferralOnPaidInvoice(client,indicada.storeId,invoice)
  await applyMerchantStripeCredits(client,indicadora.storeId,fakeStripe,'test')
  await applyMerchantStripeCredits(client,indicadora.storeId,fakeStripe,'test')
  await client.query('COMMIT')
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 assert.equal(fakeCalls.length,1,'Não duplicar saldo da Stripe em reprocessamento')
 assert.equal(fakeCalls[0].fields.amount.startsWith('-'),true)
 const qualified=(await pool.query('SELECT status,credit_status FROM shopvax_referral_claims WHERE referred_store_id=$1',[indicada.storeId])).rows[0]
 assert.equal(qualified.status,'qualified')
 assert.equal(qualified.credit_status,'applied')
 const reversedClient=await pool.connect()
 try{
  await reversedClient.query('BEGIN')
  assert.equal(await reverseReferralForRefund(reversedClient,invoice,fakeStripe,'test'),true)
  assert.equal(await reverseReferralForRefund(reversedClient,invoice,fakeStripe,'test'),false)
  await reversedClient.query('COMMIT')
 }catch(e){await reversedClient.query('ROLLBACK');throw e}finally{reversedClient.release()}
 assert.equal(fakeCalls.length,2,'Estorno total gera ajuste reverso idempotente')
 assert.equal(fakeCalls[1].fields.amount.startsWith('-'),false)
 assert.equal((await pool.query('SELECT status FROM shopvax_referral_claims WHERE referred_store_id=$1',[indicada.storeId])).rows[0].status,'reversed')
 // Independent partner, no reward assumed before commercial terms are configured.
 const partnerUser=await makeUser('parceiro')
 const partnerId=crypto.randomUUID()
 const codePartner='SVP-'+seed.toUpperCase()
 await pool.query("INSERT INTO shopvax_partners(id,user_id,code,status,commission_cents) VALUES($1,$2,$3,'active',1500)",[partnerId,partnerUser.userId,codePartner])
 const invited=await makeUser('parceiraindicada')
 assert.equal((await captureReferral(invited.storeId,codePartner)).type,'partner')
 assert.equal((await pool.query('SELECT status FROM shopvax_referral_claims WHERE referred_store_id=$1',[invited.storeId])).rows[0].status,'pending')
 const cli=await pool.connect()
 try{await cli.query('BEGIN');await qualifyReferralOnPaidInvoice(cli,invited.storeId,'in_partner_'+seed);await cli.query('COMMIT')}
 catch(e){await cli.query('ROLLBACK');throw e}finally{cli.release()}
 const commission=(await pool.query('SELECT status,commission_cents,commission_status FROM shopvax_referral_claims WHERE referred_store_id=$1',[invited.storeId])).rows[0]
 assert.deepEqual({status:commission.status,amount:commission.commission_cents,commission:commission.commission_status},{status:'qualified',amount:1500,commission:'pending_approval'})
 assert.equal((await captureReferral(invited.storeId,codePartner)).existing,true)
 // HTTP: independent partner has a real account but no merchant store.
 const base=process.env.BASE_URL || 'http://127.0.0.1:3000'
 const newEmail='grp2-newpartner-'+seed+'@example.test'
 const registered=await fetch(base+'/api/partners/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Parceira Independente',email:newEmail,password:'SenhaTesteSegura2026!'})})
 assert.equal(registered.status,201,await registered.text().catch(()=>''),'Cadastro autônomo de parceiro')
 const cookie=String(registered.headers.get('set-cookie')||'').split(';')[0]
 assert.match(cookie,/atacado_session=/)
 const newUser=(await pool.query('SELECT id FROM users WHERE email=$1',[newEmail])).rows[0]
 users.push(newUser.id)
 assert.equal((await pool.query('SELECT 1 FROM stores WHERE owner_id=$1',[newUser.id])).rowCount,0,'Parceiro não cria loja')
 const profileResponse=await fetch(base+'/api/partners/dashboard',{headers:{cookie}})
 assert.equal(profileResponse.status,200)
 const profile=await profileResponse.json()
 assert.equal(profile.partner.status,'pending')
 assert.equal(profile.partner.code,null,'Código não é público antes da aprovação')
 const codeNew=(await pool.query('SELECT code FROM shopvax_partners WHERE user_id=$1',[newUser.id])).rows[0].code
 assert.equal((await fetch(base+'/api/public/referrals/resolve?code='+codeNew)).status,404)
 await pool.query("UPDATE shopvax_partners SET status='active' WHERE user_id=$1",[newUser.id])
 const resolvedHttp=await fetch(base+'/api/public/referrals/resolve?code='+codeNew)
 assert.equal(resolvedHttp.status,200)
 assert.equal((await resolvedHttp.json()).type,'partner')
 assert.equal((await fetch(base+'/api/platform/referrals')).status,401,'Métricas centralizadas exigem autorização administrativa')
 const invalidLogin=await fetch(base+'/api/partners/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:newEmail,password:'incorrect!'})})
 assert.equal(invalidLogin.status,401)
 console.log('GRUPO2_REFERRALS_STRIPE_LEDGER_OK')
}finally{
 for(const userId of users.reverse())await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>undefined)
 await pool.end()
}
