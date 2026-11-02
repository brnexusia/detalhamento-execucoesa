import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true})
try{
 for (const width of [390,1366]){
  const page=await browser.newPage({viewport:{width,height:880}})
  await page.route('**/api/partners/dashboard',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"Autenticação necessária"}'}))
  await page.goto('http://127.0.0.1:5173/parceiros/cadastro')
  await page.getByRole('heading',{name:'Seja parceiro ShopVax.'}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'Nome completo'}).count(),1)
  assert.equal(await page.getByRole('button',{name:/Criar conta de parceiro/}).count(),1)
  await page.getByRole('button',{name:/Já tem cadastro/}).click()
  await page.getByRole('heading',{name:'Acesse seu painel de indicações.'}).waitFor()
  await page.close()
 }
 const page=await browser.newPage({viewport:{width:390,height:880}})
 await page.route('**/api/partners/dashboard',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
  partner:{name:'Parceira Teste',email:'teste@example.test',code:'SVP-CODIGO',status:'active',commissionCents:1500,pixKey:'',createdAt:new Date().toISOString()},
  metrics:{visits:7,registered:2,qualified:1,pending:1,earnedCents:1500,paidCents:0},
  referrals:[{storeName:'Loja Teste',status:'qualified',createdAt:new Date().toISOString(),qualifiedAt:new Date().toISOString(),commissionCents:1500,commissionStatus:'pending_approval',paidAt:null}],
 })}))
 await page.goto('http://127.0.0.1:5173/parceiros')
 await page.getByRole('heading',{name:'Olá, Parceira Teste.'}).waitFor()
 assert.match(await page.locator('.svx-partner__dashboard').innerText(),/SVP-CODIGO/)
 assert.match(await page.locator('.svx-partner__dashboard').innerText(),/Pagamento confirmado/)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
 await page.close()
}finally{await browser.close()}
console.log('GRUPO2_PARCEIROS_UI_OK')
