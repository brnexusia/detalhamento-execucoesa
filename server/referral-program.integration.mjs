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
 // Estorno recebido antes do invoice.paid nunca libera crédito retroativo.
 const late=await makeUser('estornoantes')
 assert.equal((await captureReferral(late.storeId,code)).ok,true)
 const earlyRefund=await pool.connect()
 try {
  await earlyRefund.query('BEGIN')
  assert.equal(await reverseReferralForRefund(earlyRefund,'in_reversed_before_paid_'+seed,fakeStripe,'test'),false)
  assert.equal(await qualifyReferralOnPaidInvoice(earlyRefund,late.storeId,'in_reversed_before_paid_'+seed),null)
  await earlyRefund.query('COMMIT')
 } catch(e) { await earlyRefund.query('ROLLBACK');throw e } finally{earlyRefund.release()}
 assert.equal((await pool.query('SELECT status FROM shopvax_referral_claims WHERE referred_store_id=$1',[late.storeId])).rows[0].status,'pending')
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
 const registeredBody=await registered.json()
 assert.equal(registered.status,201,JSON.stringify(registeredBody))
 assert.equal(registeredBody.status,'active','Conta ativa e link disponível no ato do cadastro')
 const cookie=String(registered.headers.get('set-cookie')||'').split(';')[0]
 assert.match(cookie,/(shopvax_session|atacado_session)=/)
 const newUser=(await pool.query('SELECT id FROM users WHERE email=$1',[newEmail])).rows[0]
 users.push(newUser.id)
 assert.equal((await pool.query('SELECT 1 FROM stores WHERE owner_id=$1',[newUser.id])).rowCount,0,'Parceiro não cria loja')
 const profileResponse=await fetch(base+'/api/partners/dashboard',{headers:{cookie}})
 assert.equal(profileResponse.status,200)
 const profile=await profileResponse.json()
 assert.equal(profile.partner.status,'active')
 const codeNew=(await pool.query('SELECT code FROM shopvax_partners WHERE user_id=$1',[newUser.id])).rows[0].code
 const partnerRowId=(await pool.query('SELECT id FROM shopvax_partners WHERE user_id=$1',[newUser.id])).rows[0].id
 assert.equal(profile.partner.code,codeNew,'Código disponível após autenticação')
 assert.equal(registeredBody.code,codeNew)
 assert.equal(registeredBody.referralPath,'/criar-conta?ref='+encodeURIComponent(codeNew),'Link associado diretamente ao parceiro')
 const resolvedHttp=await fetch(base+'/api/public/referrals/resolve?code='+codeNew)
 assert.equal(resolvedHttp.status,200)
 assert.equal((await resolvedHttp.json()).type,'partner')
 assert.equal((await fetch(base+'/api/platform/referrals')).status,401,'Métricas centralizadas exigem autorização administrativa')
 // Cadastro sem checkout já registra a loja no parceiro, sem gerar comissão.
 const storeEmail='grp2-merchant-'+seed+'@example.test'
 const signup=await fetch(base+'/api/auth/register',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Lojista Indicado',email:storeEmail,password:'SenhaDeTesteSegura2026',
     storeName:'Loja indicada pelo parceiro',planCode:'bronze',referralCode:codeNew}),
 })
 assert.equal(signup.status,201,await signup.text().catch(()=>''),'Cadastro com código deve ser aceito')
 const merchantUser=(await pool.query('SELECT id FROM users WHERE email=$1',[storeEmail])).rows[0]
 users.push(merchantUser.id)
 const registeredStore=(await pool.query('SELECT id FROM stores WHERE owner_id=$1',[merchantUser.id])).rows[0]
 const linkedAtSignup=(await pool.query('SELECT partner_id,status,commission_cents FROM shopvax_referral_claims WHERE referred_store_id=$1',[registeredStore.id])).rows[0]
 assert.deepEqual(linkedAtSignup,{partner_id:partnerRowId,status:'pending',commission_cents:0},'Sem checkout não concede comissão')
 assert.equal((await pool.query('SELECT 1 FROM shopvax_stripe_billing WHERE store_id=$1',[registeredStore.id])).rowCount,0,'Sem checkout Stripe ainda')
 const invalidEmail='grp2-invalid-'+seed+'@example.test'
 const invalid=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   name:'Cadastro inválido',email:invalidEmail,password:'SenhaDeTesteSegura2026',storeName:'Outra Loja',planCode:'bronze',referralCode:'SVP-INVALIDO',
 })})
 assert.equal(invalid.status,409,'Código inválido impede cadastro órfão')
 assert.equal((await pool.query('SELECT id FROM users WHERE email=$1',[invalidEmail])).rowCount,0,'Transação deve reverter o usuário inválido')
 // Apenas administradores consultam identidade e histórico paginado das lojas de cada parceiro.
 assert.equal((await fetch(base+'/api/platform/referrals/partners/'+partnerRowId+'/referrals',{headers:{cookie}})).status,403)
 await pool.query('INSERT INTO platform_admins(user_id,created_by) VALUES($1,$1) ON CONFLICT DO NOTHING',[newUser.id])
 const adminReport=await fetch(base+'/api/platform/referrals',{headers:{cookie}})
 assert.equal(adminReport.status,200)
 const adminData=await adminReport.json()
 const partnerStats=adminData.partners.find(p=>p.id===partnerRowId)
 assert.equal(Number(partnerStats.registered_only),1,'ADM mostra cadastro abandonado antes de checkout')
 assert.equal(Number(partnerStats.checkout_started),0)
 const detailUrl=base+'/api/platform/referrals/partners/'+partnerRowId+'/referrals'
 const firstDetailResponse=await fetch(detailUrl+'?page=1&limit=1',{headers:{cookie}})
 assert.equal(firstDetailResponse.status,200)
 const firstDetail=await firstDetailResponse.json()
 assert.equal(firstDetail.total,1)
 assert.equal(firstDetail.items[0].store_email,storeEmail)
 assert.equal(firstDetail.items[0].checkout_started_at,null)
 const fakeStartedAt=new Date().toISOString()
 await pool.query('INSERT INTO shopvax_stripe_billing(store_id,checkout_started_at) VALUES($1,$2)',[registeredStore.id,fakeStartedAt])
 const checkoutReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie}})).json()
 const startedStats=checkoutReport.partners.find(p=>p.id===partnerRowId)
 assert.equal(Number(startedStats.registered_only),0)
 assert.equal(Number(startedStats.checkout_started),1,'Checkout pendente difere de cadastro sem pagamento')
 const paidClient=await pool.connect()
 try {
   await paidClient.query('BEGIN')
   await qualifyReferralOnPaidInvoice(paidClient,registeredStore.id,'in_linked_signup_'+seed)
   await paidClient.query('COMMIT')
 }catch(e){await paidClient.query('ROLLBACK');throw e}finally{paidClient.release()}
 const paidReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie}})).json()
 assert.equal(Number(paidReport.partners.find(p=>p.id===partnerRowId).paid_referrals),1)
 const qualifiedDetail=await (await fetch(detailUrl,{headers:{cookie}})).json()
 assert.equal(qualifiedDetail.items[0].status,'qualified')
 assert.equal(qualifiedDetail.items[0].commission_status,'awaiting_rule','Sem comissão definida não gera dívida fictícia')
 const reversalClient=await pool.connect()
 try{
   await reversalClient.query('BEGIN')
   await reverseReferralForRefund(reversalClient,'in_linked_signup_'+seed,fakeStripe,'test')
   await reversalClient.query('COMMIT')
 }catch(e){await reversalClient.query('ROLLBACK');throw e}finally{reversalClient.release()}
 const reversedReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie}})).json()
 assert.equal(Number(reversedReport.partners.find(p=>p.id===partnerRowId).reversed_referrals),1,'ADM identifica estorno')
 await pool.query('DELETE FROM platform_admins WHERE user_id=$1',[newUser.id])

 const invalidLogin=await fetch(base+'/api/partners/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:newEmail,password:'incorrect!'})})
 assert.equal(invalidLogin.status,401)
 console.log('GRUPO2_REFERRALS_STRIPE_LEDGER_OK')
}finally{
 for(const userId of users.reverse())await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>undefined)
 await pool.end()
}
