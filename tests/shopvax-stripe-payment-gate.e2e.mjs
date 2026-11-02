import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true})
const url='http://127.0.0.1:5173'
async function mock(page,status){
 await page.route('**/api/auth/me',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
  user:{id:'u1',name:'Teste',email:'teste@example.test'},store:{id:'s1',slug:'teste',name:'Teste',billing_required:true,plan_tier:'bronze'},
 })}))
 await page.route('**/api/billing/status',r=>status==='offline'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"Serviço temporariamente indisponível"}'}):
 r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
  enabled:true,required:true,accessGranted:status==='paid',status:status==='paid'?'active':'none',planCode:status==='paid'?'bronze':null,
  cycle:null,paidUntil:null,cancelAtPeriodEnd:false,prices:[],
 })}))
}
try {
 for(const width of [390,1366]){
  for(const path of ['/painel','/painel/produtos','/painel/crescimento','/painel/loja']){
   const page=await browser.newPage({viewport:{width,height:840}})
   await mock(page,'pending')
   await page.goto(url+path)
   await page.waitForURL(x=>x.pathname==='/painel/assinatura',{timeout:12000})
   assert.equal(await page.locator('.panel-shell').count(),0,'Painel montou antes do pagamento: '+path)
   await page.getByRole('heading',{name:'Plano e cobrança'}).waitFor()
   await page.close()
  }
 }
 const signup=await browser.newPage({viewport:{width:390,height:844}})
 await signup.route('**/api/auth/me',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"Não autenticado"}'}))
 await signup.route('**/api/billing/public-plans',r=>r.fulfill({status:200,contentType:'application/json',
  body:JSON.stringify({enabled:false,plans:[{code:'bronze',name:'Bronze',monthlyPrice:49.90,sellerLimit:5,catalogLimit:1,photoLimit:5,cycles:[{code:'monthly',amountCents:4990}]}]})}))
 await signup.goto(url+'/criar-conta')
 await signup.getByText('Pagamento temporariamente indisponível.',{exact:false}).waitFor()
 assert.equal(await signup.getByRole('button',{name:/Criar minha loja$/}).isDisabled(),true,
  'Não permitir criar loja sem Stripe pronta.')
 await signup.close()
 const down=await browser.newPage()
 await mock(down,'offline')
 await down.goto(url+'/painel/relatorios')
 await down.getByText('Não foi possível confirmar a assinatura.').waitFor()
 assert.equal(await down.locator('.panel-shell').count(),0)
 await down.close()
 const allowed=await browser.newPage()
 await mock(allowed,'paid')
 await allowed.goto(url+'/painel/assinatura')
 await allowed.locator('.panel-shell').waitFor()
 console.log('PAID_USER_CAN_OPEN_PANEL_SHELL_OK')
 await allowed.close()
 console.log('UNPAID_USER_BLOCKED_FROM_ALL_PANEL_ROUTES_OK')
}finally{await browser.close()}
