import assert from 'node:assert/strict'
import {chromium} from 'playwright'

const origin='http://127.0.0.1:5173'
const plans=[
 {code:'bronze',name:'Bronze',monthlyPrice:49.90,sellerLimit:5,productLimit:500,catalogLimit:1,photoLimit:5,franchiseeLimit:0,cycles:[{code:'monthly',amountCents:4990}]},
 {code:'prata',name:'Prata',monthlyPrice:94.90,sellerLimit:15,productLimit:2000,catalogLimit:3,photoLimit:10,franchiseeLimit:2,cycles:[{code:'monthly',amountCents:9490}]},
 {code:'ouro',name:'Ouro',monthlyPrice:144.90,sellerLimit:null,productLimit:null,catalogLimit:null,photoLimit:null,franchiseeLimit:null,cycles:[{code:'monthly',amountCents:14490}]},
]
const browser=await chromium.launch({headless:true})
async function setupGoogle(page) {
 await page.addInitScript(()=>{
  window.google={accounts:{id:{
   initialize: config=>{window.__shopvaxGoogleTestCallback=config.callback},
   renderButton:element=>{
    element.replaceChildren()
    const button=document.createElement('button')
    button.type='button';button.textContent='Entrar com Google teste'
    button.addEventListener('click',()=>window.__shopvaxGoogleTestCallback({credential:'gsi-test-credential'}))
    element.appendChild(button)
   },
   cancel:()=>{},
  }}}
 })
 await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"enabled":true,"clientId":"test-client.apps.googleusercontent.com"}'}))
}
async function setupBase(page, {registered=false, billing={enabled:true,required:true,accessGranted:false,status:'none',planCode:null,cycle:null,paidUntil:null,cancelAtPeriodEnd:false,prices:[]}}={}) {
 const user={registered}
 await page.route('**/api/auth/me',r=>r.fulfill({status:user.registered?200:401,contentType:'application/json',body:user.registered?
  '{"user":{"id":"u1","name":"Lojista","email":"teste@example.test"},"store":{"id":"s1","slug":"loja","name":"Loja"}}':'{"error":"Sessão inválida"}'}))
 await page.route('**/api/billing/status',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(billing)}))
 await page.route('**/api/billing/public-plans',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,plans})}))
 await page.route('https://checkout.stripe.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Stripe Hosted Test</title><h1>Stripe</h1>'}))
 return user
}
async function testGoogleSignup(path, noStoreExisting){
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const state=await setupBase(page)
 await setupGoogle(page)
 const intents=[]
 let checkout=null
 await page.route('**/api/auth/google',async r=>{
  const body=r.request().postDataJSON();intents.push(body.intent)
  if(body.intent==='login'){
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(noStoreExisting?
    {ok:true,created:false,storeSlug:'',profile:{name:'Usuária Google',email:'google@example.test'}}:
    {ok:false,needsSignup:true,profile:{name:'Usuária Google',email:'google@example.test'}})})
  }else{
   assert.equal(body.storeName,'Atacado Google')
   assert.equal(body.planCode,'ouro')
   state.registered=true
   await r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,created:true,storeSlug:'atacado-google',profile:{name:'Usuária Google',email:'google@example.test'}})})
  }
 })
 await page.route('**/api/billing/checkout',async r=>{
  checkout=r.request().postDataJSON()
  await r.fulfill({status:200,contentType:'application/json',body:'{"url":"https://checkout.stripe.com/c/pay/cs_test_google"}'})
 })
 await page.goto(origin+path)
 await page.getByRole('button',{name:'Entrar com Google teste'}).click()
 await page.getByRole('heading',{name:'Complete os dados da sua loja.'}).waitFor()
 if(noStoreExisting) await page.getByRole('button',{name:/Ouro/}).first().click()
 await page.locator('input[placeholder="Ex.: Atacado Aurora"]').fill('Atacado Google')
 await page.getByRole('button',{name:/Prosseguir com Google e pagar/}).click()
 await page.waitForURL(/checkout\.stripe\.com\/c\/pay\//,{timeout:14000})
 assert.deepEqual(intents,['login','register'])
 assert.equal(checkout.planCode,'ouro')
 assert.equal(checkout.cycle,'monthly')
 console.log('GOOGLE_SIGNUP_STRIPE_OK',noStoreExisting?'existing_without_store':'new_google_account')
 await page.close()
}
async function testUnpaidLogin(method, next) {
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const state=await setupBase(page)
 await setupGoogle(page)
 let authCount=0
 await page.route('**/api/auth/login',async r=>{
  state.registered=true;authCount++
  await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
 })
 await page.route('**/api/auth/google',async r=>{
  state.registered=true;authCount++
  await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"created":false,"storeSlug":"loja","profile":{"name":"Lojista","email":"lojista@example.test"}}'})
 })
 await page.goto(origin+'/entrar?trocar-conta=1'+(next?'&next='+encodeURIComponent('/painel/produtos'):''))
 if(method==='google') await page.getByRole('button',{name:'Entrar com Google teste'}).click()
 else {
  await page.locator('.auth-form input[type=email]').fill('loja@example.test')
  await page.locator('.auth-form input[type=password]').fill('senha-de-teste')
  await page.locator('.auth-form .primary-action').click()
 }
 await page.waitForURL(url=>url.pathname==='/painel/assinatura',{timeout:14000})
 assert.equal(authCount,1,'Não deve tentar um segundo login')
 console.log('UNPAID_LOGIN_PAYMENT_GATE_OK',method,next?'deep_link':'default')
 await page.close()
}
try {
 await testGoogleSignup('/criar-conta?plan=ouro',false)
 await testGoogleSignup('/entrar?trocar-conta=1&plan=ouro',true)
 await testUnpaidLogin('password',true)
 await testUnpaidLogin('google',false)
}finally{await browser.close()}
console.log('GOOGLE_AND_LOGIN_PAYMENT_ROUTING_OK')
