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
 // O backend inicializa as tabelas da Stripe em paralelo ao endpoint /health.
 // Aguardar a migração evita que o teste dependa de uma corrida de inicialização.
 let stripeTableReady=false
 for(let attempt=0;attempt<120;attempt++){
  const row=(await pool.query("SELECT to_regclass('public.shopvax_stripe_billing') AS table_name")).rows[0]
  if(row?.table_name){stripeTableReady=true;break}
  await new Promise(resolve=>setTimeout(resolve,250))
 }
 assert.equal(stripeTableReady,true,'O backend deve inicializar a tabela de cobrança antes de validar indicações')
 // O health da aplicação sinaliza o schema base; hooks do catálogo ainda podem
 // executar DDL em paralelo. Não movimentar créditos em meio à primeira migração.
 let otherMigrationsReady=false
 for(let attempt=0;attempt<160;attempt++){
   const ready=(await pool.query([
     "SELECT count(*)::int AS count FROM information_schema.columns",
     "WHERE (table_name='orders' AND column_name='coupon_code')",
     "OR (table_name='platform_plans' AND column_name='feature_flags')",
   ].join(' '))).rows[0]
   if(Number(ready?.count)===2){otherMigrationsReady=true;break}
   await new Promise(resolve=>setTimeout(resolve,250))
 }
 assert.equal(otherMigrationsReady,true,'Esperar as migrações concorrentes do painel antes do ledger Stripe')
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
 for(const route of ['/parceiros','/parceiros/cadastro','/afiliados','/afiliados/cadastro']){
   const page=await fetch(base+route)
   assert.equal(page.status,200,'Rota pública de parceiros deve abrir: '+route)
 }
 const registered=await fetch(base+'/api/partners/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Parceira Independente',email:newEmail,password:'SenhaTesteSegura2026!'})})
 const registeredBody=await registered.json()
 assert.equal(registered.status,201,JSON.stringify(registeredBody))
 assert.equal(registeredBody.status,'active','Conta ativa e link disponível no ato do cadastro')
 const cookie=String(registered.headers.get('set-cookie')||'').split(';')[0]
 assert.match(cookie,/shopvax_partner_session=/)
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
 const visitCookie=String(resolvedHttp.headers.get('set-cookie')||'').split(';')[0]
 assert.match(visitCookie,/shopvax_ref_visit=/)
 const viewedAgain=await fetch(base+'/api/public/referrals/resolve?code='+codeNew,{headers:{cookie:visitCookie}})
 assert.equal(viewedAgain.status,200)
 assert.equal((await pool.query('SELECT count(*)::int AS visits FROM shopvax_referral_visits WHERE code=$1',[codeNew])).rows[0].visits,1,
   'Atualização da mesma página pelo mesmo visitante não infla a métrica de visitas')
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
 const partnerAfterSignup=await (await fetch(base+'/api/partners/dashboard',{headers:{cookie}})).json()
 assert.equal(partnerAfterSignup.metrics.registered,1,'Cadastro com código aparece imediatamente ao parceiro')
 assert.equal(partnerAfterSignup.metrics.registeredOnly,1,'Lojista indicado sem pagamento aparece na etapa certa')
 assert.equal(partnerAfterSignup.metrics.qualified,0,'Não contar cadastro como assinatura paga')
 assert.equal(partnerAfterSignup.referralsTotal,1)
 assert.equal((await pool.query('SELECT 1 FROM shopvax_stripe_billing WHERE store_id=$1',[registeredStore.id])).rowCount,0,'Sem checkout Stripe ainda')
 // A mesma conta pode manter loja e programa de afiliados em sessões distintas.
 const ownerEmail='grp2-owner-partner-'+seed+'@example.test'
 const ownerPassword='SenhaExistente2026!'
 const ownerSignup=await fetch(base+'/api/auth/register',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'Lojista parceiro',email:ownerEmail,password:ownerPassword,
     storeName:'Loja afiliada',planCode:'bronze'}),
 })
 assert.equal(ownerSignup.status,201,'Criar loja antes de ativar o programa de parceiros')
 const ownerExisting=(await pool.query('SELECT id FROM users WHERE email=$1',[ownerEmail])).rows[0]
 users.push(ownerExisting.id)
 const storeCookie=String(ownerSignup.headers.get('set-cookie')||'').split(';')[0]
 assert.match(storeCookie,/(shopvax_session|atacado_session)=/)
 const activatePartner=await fetch(base+'/api/partners/register',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'',email:ownerEmail,password:ownerPassword}),
 })
 assert.equal(activatePartner.status,201,'Lojista com senha válida ativa programa de parceiros sem trocar a conta')
 const activatedCookie=String(activatePartner.headers.get('set-cookie')||'').split(';')[0]
 assert.match(activatedCookie,/shopvax_partner_session=/)
 assert.equal((await fetch(base+'/api/partners/dashboard',{headers:{cookie:activatedCookie}})).status,200)
 assert.equal((await fetch(base+'/api/auth/me',{headers:{cookie:storeCookie}})).status,200,'Cookie da loja mantém sessão sem interferência')
 const duplicatePartner=await fetch(base+'/api/partners/register',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({name:'',email:ownerEmail,password:ownerPassword}),
 })
 assert.equal(duplicatePartner.status,409,'Não permitir dois códigos para a mesma conta')
 const invalidEmail='grp2-invalid-'+seed+'@example.test'
 const invalid=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   name:'Cadastro inválido',email:invalidEmail,password:'SenhaDeTesteSegura2026',storeName:'Outra Loja',planCode:'bronze',referralCode:'SVP-INVALIDO',
 })})
 assert.ok([400,409].includes(invalid.status),'Código inválido impede cadastro órfão')
 assert.equal((await pool.query('SELECT id FROM users WHERE email=$1',[invalidEmail])).rowCount,0,'Transação deve reverter o usuário inválido')
 // Apenas administradores consultam identidade e histórico paginado das lojas de cada parceiro.
 assert.equal((await fetch(base+'/api/platform/referrals/partners/'+partnerRowId+'/referrals',{headers:{cookie}})).status,403)
 await pool.query('INSERT INTO platform_admins(user_id,created_by) VALUES($1,$1) ON CONFLICT DO NOTHING',[newUser.id])
 const ownerLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:newEmail,password:'SenhaTesteSegura2026!'})})
 assert.equal(ownerLogin.status,200,'Sessão administrativa usa cookie de proprietário separado da sessão de parceiro')
 const adminCookie=String(ownerLogin.headers.get('set-cookie')||'').split(';')[0]
 assert.match(adminCookie,/(shopvax_session|atacado_session)=/)
 const adminReport=await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})
 assert.equal(adminReport.status,200)
 const adminData=await adminReport.json()
 const partnerStats=adminData.partners.find(p=>p.id===partnerRowId)
 assert.equal(Number(partnerStats.registered_only),1,'ADM mostra cadastro abandonado antes de checkout')
 assert.equal(Number(partnerStats.checkout_started),0)
 const detailUrl=base+'/api/platform/referrals/partners/'+partnerRowId+'/referrals'
 const firstDetailResponse=await fetch(detailUrl+'?page=1&limit=1',{headers:{cookie:adminCookie}})
 assert.equal(firstDetailResponse.status,200)
 const firstDetail=await firstDetailResponse.json()
 assert.equal(firstDetail.total,1)
 assert.equal(firstDetail.items[0].store_email,storeEmail)
 assert.equal(firstDetail.items[0].checkout_started_at,null)
 const fakeStartedAt=new Date().toISOString()
 await pool.query('INSERT INTO shopvax_stripe_billing(store_id,checkout_started_at) VALUES($1,$2)',[registeredStore.id,fakeStartedAt])
 const checkoutReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})).json()
 const startedStats=checkoutReport.partners.find(p=>p.id===partnerRowId)
 assert.equal(Number(startedStats.registered_only),0)
 assert.equal(Number(startedStats.checkout_started),1,'Checkout pendente difere de cadastro sem pagamento')
 const paidClient=await pool.connect()
 try {
   await paidClient.query('BEGIN')
   await qualifyReferralOnPaidInvoice(paidClient,registeredStore.id,'in_linked_signup_'+seed)
   await paidClient.query('COMMIT')
 }catch(e){await paidClient.query('ROLLBACK');throw e}finally{paidClient.release()}
 const paidReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})).json()
 assert.equal(Number(paidReport.partners.find(p=>p.id===partnerRowId).paid_referrals),1)
 const qualifiedDetail=await (await fetch(detailUrl,{headers:{cookie:adminCookie}})).json()
 assert.equal(qualifiedDetail.items[0].status,'qualified')
 assert.equal(qualifiedDetail.items[0].commission_status,'awaiting_rule','Sem comissão definida não gera dívida fictícia')
 // Aprovação, Pix cadastrado, registro de repasse e idempotência: ciclo completo.
 const configCommission=await fetch(base+'/api/platform/referrals/partners/'+partnerRowId,{
   method:'PATCH',headers:{'content-type':'application/json',cookie:adminCookie},
   body:JSON.stringify({commissionCents:2500,applyToPending:true}),
 })
 assert.equal(configCommission.status,200,'Administrador precisa conseguir definir a comissão')
 const updatedClaim=(await pool.query('SELECT commission_cents,commission_status FROM shopvax_referral_claims WHERE referred_store_id=$1',[registeredStore.id])).rows[0]
 assert.deepEqual(updatedClaim,{commission_cents:2500,commission_status:'pending_approval'})
 const pix=await fetch(base+'/api/partners/pix',{
   method:'PUT',headers:{'content-type':'application/json',cookie},
   body:JSON.stringify({pixKey:'parceiro@example.test'}),
 })
 assert.equal(pix.status,200,'Parceiro consegue registrar chave de recebimento')
 const payoutRef='PIX-REF-'+seed
 const payoutUrl=base+'/api/platform/referrals/claims/'+registeredStore.id+'/payout'
 const pay=await fetch(payoutUrl,{method:'POST',headers:{'content-type':'application/json',cookie:adminCookie},
   body:JSON.stringify({reference:payoutRef})})
 assert.equal(pay.status,200,'ADM deve registrar pagamento externo comprovado')
 assert.equal((await pay.json()).recorded,true)
 const secondPay=await fetch(payoutUrl,{method:'POST',headers:{'content-type':'application/json',cookie:adminCookie},
   body:JSON.stringify({reference:payoutRef})})
 assert.equal(secondPay.status,409,'Nunca registrar a mesma comissão como paga duas vezes')
 const paidDash=await (await fetch(base+'/api/partners/dashboard',{headers:{cookie}})).json()
 assert.equal(paidDash.metrics.paidCents,2500,'Parceiro vê repasse confirmado no próprio painel')
 const payoutRow=(await pool.query('SELECT paid_at,payout_reference FROM shopvax_referral_claims WHERE referred_store_id=$1',[registeredStore.id])).rows[0]
 assert.ok(payoutRow.paid_at)
 assert.equal(payoutRow.payout_reference,payoutRef)
 const reversalClient=await pool.connect()
 try{
   await reversalClient.query('BEGIN')
   await reverseReferralForRefund(reversalClient,'in_linked_signup_'+seed,fakeStripe,'test')
   await reversalClient.query('COMMIT')
 }catch(e){await reversalClient.query('ROLLBACK');throw e}finally{reversalClient.release()}
 const reversedReport=await (await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})).json()
 assert.equal(Number(reversedReport.partners.find(p=>p.id===partnerRowId).reversed_referrals),1,'ADM identifica estorno')
 // Mais indicações do que o limite de uma página: totais completos em ambos os painéis.
 // Uma loja por usuário evita violar o vínculo exclusivo da conta lojista.
 const extra=35
 for(let n=1;n<=extra;n++)users.push('grp2-bulk-user-'+seed+'-'+n)
 await pool.query([
  "INSERT INTO users(id,name,email,password_hash)",
  "SELECT 'grp2-bulk-user-'||$1||'-'||gs.n,'Indicado '||gs.n,",
  "'grp2-bulk-'||$1||'-'||gs.n||'@example.test','disabled'",
  "FROM generate_series(1,35) AS gs(n)",
 ].join(' '),[seed])
 await pool.query([
  "INSERT INTO stores(id,owner_id,slug,name)",
  "SELECT 'grp2-bulk-store-'||$1||'-'||gs.n,'grp2-bulk-user-'||$1||'-'||gs.n,",
  "'grp2-bulk-'||$1||'-'||gs.n,'Loja indicacao '||gs.n",
  "FROM generate_series(1,35) AS gs(n)",
 ].join(' '),[seed])
 await pool.query([
  "INSERT INTO shopvax_referral_claims(referred_store_id,referral_code,partner_id)",
  "SELECT 'grp2-bulk-store-'||$1||'-'||gs.n,$2,$3",
  "FROM generate_series(1,35) AS gs(n)",
 ].join(' '),[seed,codeNew,partnerRowId])
 const dashboardPage1=await (await fetch(base+'/api/partners/dashboard',{headers:{cookie}})).json()
 assert.equal(dashboardPage1.metrics.registered,extra+1,'Parceiro precisa contar TODOS os cadastros, não apenas uma página')
 assert.equal(dashboardPage1.metrics.pending,extra)
 assert.equal(dashboardPage1.metrics.registeredOnly,extra)
 assert.equal(dashboardPage1.metrics.qualified,0)
 assert.equal(dashboardPage1.referralsTotal,extra+1)
 assert.equal(dashboardPage1.referralsPage,1)
 assert.equal(dashboardPage1.referralsLimit,30)
 assert.equal(dashboardPage1.referrals.length,30,'Primeira página não pode carregar todos os registros')
 const dashboardPage2=await (await fetch(base+'/api/partners/dashboard?page=2',{headers:{cookie}})).json()
 assert.equal(dashboardPage2.metrics.registered,extra+1,'Total constante na segunda página')
 assert.equal(dashboardPage2.referralsPage,2)
 assert.equal(dashboardPage2.referrals.length,extra+1-30,'As indicações antigas continuam acessíveis')
 const adminAfterBulk=await (await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})).json()
 assert.equal(Number(adminAfterBulk.partners.find(p=>p.id===partnerRowId).referrals),extra+1,
  'ADM e parceiro precisam apresentar a mesma quantidade de cadastros')
 const partnerLogout=await fetch(base+'/api/partners/logout',{method:'POST',headers:{cookie}})
 assert.equal(partnerLogout.status,200)
 assert.equal((await fetch(base+'/api/partners/dashboard',{headers:{cookie}})).status,401,'Logout parceiro revoga apenas a sessão do parceiro')
 assert.equal((await fetch(base+'/api/platform/referrals',{headers:{cookie:adminCookie}})).status,200,'Sessão administrativa permanece ativa após sair do parceiro')
 await pool.query('DELETE FROM platform_admins WHERE user_id=$1',[newUser.id])

 const invalidLogin=await fetch(base+'/api/partners/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:newEmail,password:'incorrect!'})})
 assert.equal(invalidLogin.status,401)
 console.log('GRUPO2_REFERRALS_STRIPE_LEDGER_OK')
}finally{
 for(const userId of users.reverse())await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>undefined)
 await pool.end()
}
