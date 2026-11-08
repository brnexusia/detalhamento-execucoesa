import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base='http://127.0.0.1:5173'
const browser=await chromium.launch({headless:true})
const now=new Date('2026-11-08T12:00:00Z').toISOString()
const partner={
 id:'p1',code:'SVP-TESTECODE',status:'active',commission_cents:1500,pix_key:'',created_at:now,
 name:'Parceiro Teste',email:'parceiro@example.test',referrals:2,registered_only:1,checkout_started:0,
 paid_referrals:1,reversed_referrals:0,pending_commission_cents:1500,paid_commission_cents:0,
}
const registerOnly={
 referred_store_id:'s1',store_name:'Loja Sem Checkout',store_slug:'loja-sem-checkout',
 store_email:'loja-sem-checkout@example.test',registered_at:now,referral_code:partner.code,
 status:'pending',created_at:now,qualified_at:null,reversed_at:null,first_invoice_id:null,
 checkout_started_at:null,subscription_status:null,paid_until:null,
 commission_cents:0,commission_status:'none',paid_at:null,payout_reference:null,
}
const paid={
 ...registerOnly,referred_store_id:'s2',store_name:'Loja Pagante',store_email:'pagante@example.test',
 status:'qualified',qualified_at:now,first_invoice_id:'in_test_paid',
 checkout_started_at:now,subscription_status:'active',commission_cents:1500,commission_status:'pending_approval',
}
try{
 for(const width of [390,1366]){
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('**/api/platform/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    user:{id:'admin',name:'Administrador',email:'admin@example.test',hasPassword:true,hasGoogle:false},
    stats:{stores:0,active_stores:0,users:0,products:0,orders:0,order_value:0},
    stores:[],admins:[],latestUsers:[],plans:[],audit:[],
  })}))
  await page.route('**/api/platform/referrals',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    partners:[partner],claims:[],metrics:{
      pending:1,qualified:1,reversed:0,commissionPendingCents:1500,commissionPaidCents:0,creditedMonths:0,
    },
  })}))
  await page.route('**/api/platform/referrals/partners/p1/referrals?*',r=>{
    const url=new URL(r.request().url())
    const current=Number(url.searchParams.get('page')||1)
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      partnerId:'p1',code:partner.code,page:current,limit:30,total:2,items:[registerOnly,paid],
    })})
  })
  await page.goto(base+'/admin')
  await page.getByRole('button',{name:'Parceiros e indicações'}).click()
  await page.getByRole('heading',{name:'Parceiros e indicações'}).waitFor()
  assert.equal(await page.getByText('Loja Sem Checkout').count(),0,'Não abrir detalhes sem pedido explícito')
  assert.match(await page.locator('.svx-referral-admin__funnel').innerText(),/Sem Checkout/)
  await page.getByRole('button',{name:'Ver lojas'}).click()
  await page.getByText('Loja Sem Checkout').waitFor()
  assert.match(await page.locator('.svx-referral-admin__detail').innerText(),/Cadastrado · ainda não iniciou Checkout/)
  assert.match(await page.locator('.svx-referral-admin__detail').innerText(),/Pagamento confirmado/)
  assert.match(await page.locator('.svx-referral-admin__detail').innerText(),/Aguardando definição da comissão|Comissão aguardando aprovação/)
  assert.equal(await page.getByRole('button',{name:'Próxima'}).isDisabled(),true)
  assert.equal(await page.locator('.svx-referral-admin__partner').count(),1)
  await page.getByRole('button',{name:'Fechar lojas'}).click()
  assert.equal(await page.getByText('Loja Sem Checkout').count(),0)
  await page.close()
 }
 console.log('ADMIN_PARTNER_FUNNEL_MOBILE_DESKTOP_OK')
}finally{await browser.close()}
