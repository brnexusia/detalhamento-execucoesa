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
 // Cadastro confirmado libera, na mesma sessão, o código e o link atribuíveis.
 const signupPage=await browser.newPage({viewport:{width:390,height:880}})
 let registered=false
 await signupPage.route('**/api/partners/dashboard',r=>r.fulfill({
  status:registered?200:401,contentType:'application/json',
  body:registered?JSON.stringify({
   partner:{name:'Parceiro Modelo',email:'partner@example.test',code:'SVP-TESTECODE',status:'active',commissionCents:0,pixKey:'',createdAt:new Date().toISOString()},
   metrics:{visits:0,registered:0,qualified:0,pending:0,earnedCents:0,paidCents:0},referrals:[],
  }):'{"error":"Autenticação necessária"}',
 }))
 await signupPage.route('**/api/partners/register',r=>{
  registered=true
  return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,status:'active',code:'SVP-TESTECODE',referralPath:'/criar-conta?ref=SVP-TESTECODE'})})
 })
 await signupPage.goto('http://127.0.0.1:5173/parceiros/cadastro')
 await signupPage.getByRole('heading',{name:'Seja parceiro ShopVax.'}).waitFor()
 await signupPage.getByRole('textbox',{name:'Nome completo'}).fill('Parceiro Modelo')
 await signupPage.getByRole('textbox',{name:'E-mail'}).fill('partner@example.test')
 await signupPage.locator('input[type=password]').fill('UmaSenhaSegura123!')
 await signupPage.getByRole('button',{name:/Criar conta de parceiro/}).click()
 await signupPage.getByRole('heading',{name:'Olá, Parceiro Modelo.'}).waitFor()
 assert.match(await signupPage.locator('.svx-partner__dashboard').innerText(),/SVP-TESTECODE/)
 assert.match(await signupPage.locator('.svx-partner__dashboard').innerText(),/\/criar-conta\?ref=SVP-TESTECODE/)
 assert.equal(await signupPage.getByRole('button',{name:'Copiar link'}).count(),1)
 assert.equal(await signupPage.getByRole('button',{name:'Copiar código'}).count(),1)
 assert.equal(await signupPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
 await signupPage.close()

 // Um HTML do proxy em vez de JSON nunca deve aparentar cadastro bem-sucedido.
 const brokenPage=await browser.newPage({viewport:{width:390,height:880}})
 await brokenPage.route('**/api/partners/dashboard',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"Sem sessão"}'}))
 await brokenPage.route('**/api/partners/register',r=>r.fulfill({status:200,contentType:'text/html',body:'<html>proxy fallback</html>'}))
 await brokenPage.goto('http://127.0.0.1:5173/parceiros/cadastro')
 await brokenPage.getByRole('heading',{name:'Seja parceiro ShopVax.'}).waitFor()
 await brokenPage.getByRole('textbox',{name:'Nome completo'}).fill('Teste')
 await brokenPage.getByRole('textbox',{name:'E-mail'}).fill('broken@example.test')
 await brokenPage.locator('input[type=password]').fill('UmaSenhaSegura123!')
 await brokenPage.getByRole('button',{name:/Criar conta de parceiro/}).click()
 await brokenPage.getByRole('alert').getByText(/O servidor não confirmou a operação/).waitFor()
 await brokenPage.close()

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
