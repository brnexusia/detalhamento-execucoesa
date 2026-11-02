import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
const plans = [
  {code:'bronze',name:'Bronze',monthlyPrice:49.90,sellerLimit:5,productLimit:500,catalogLimit:1,photoLimit:5,franchiseeLimit:0,cycles:[{code:'monthly',amountCents:4990},{code:'semiannual',amountCents:28443},{code:'annual',amountCents:50898}]},
  {code:'prata',name:'Prata',monthlyPrice:94.90,sellerLimit:15,productLimit:2000,catalogLimit:3,photoLimit:10,franchiseeLimit:2,cycles:[{code:'monthly',amountCents:9490},{code:'semiannual',amountCents:54093},{code:'annual',amountCents:96798}]},
  {code:'ouro',name:'Ouro',monthlyPrice:144.90,sellerLimit:null,productLimit:null,catalogLimit:null,photoLimit:null,franchiseeLimit:null,cycles:[{code:'monthly',amountCents:14490},{code:'semiannual',amountCents:82593},{code:'annual',amountCents:147798}]},
]
const origin='http://127.0.0.1:5173'
try {
  for (const success of [true,false]) {
    const page = await browser.newPage({viewport:{width:390,height:844}})
    let registered = false
    let registerCount=0
    let checkoutPayload=null
    await page.route('**/api/auth/me',r=>r.fulfill({status:registered?200:401,contentType:'application/json',body:registered?JSON.stringify({user:{id:'u1',name:'Shopvax Test',email:'teste@example.test'},store:{id:'s1',slug:'loja',name:'Loja'}}):'{"error":"Não autenticado"}'}))
    await page.route('**/api/billing/public-plans',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,plans})}))
    await page.route('**/api/public/referrals/resolve?*',r=>r.fulfill({status:200,contentType:'application/json',body:'{"valid":true,"code":"SVP-12345","type":"partner"}'}))
    await page.route('**/api/auth/register',async r=>{
      registered=true
      registerCount++
      const body=r.request().postDataJSON()
      assert.equal(body.planCode,'prata')
      assert.equal(body.referralCode,'SVP-12345')
      await r.fulfill({status:201,contentType:'application/json',body:'{"ok":true,"planCode":"prata","storeSlug":"loja"}'})
    })
    await page.route('**/api/billing/checkout',async r=>{
      checkoutPayload=r.request().postDataJSON()
      await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({url:success?'https://checkout.stripe.com/c/pay/cs_test_grp2':'https://example.invalid/checkout'})})
    })
    await page.route('https://checkout.stripe.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Stripe Test</title><h1>Stripe Test</h1>'}))
    await page.goto(origin+'/criar-conta?plan=prata&ref=SVP-12345')
    await page.getByRole('button',{name:'Semestral'}).click()
    await page.getByLabel('Seu nome').fill('Lojista Teste')
    await page.getByLabel('Nome da loja').fill('Loja Teste')
    await page.getByLabel('E-mail').fill('lojista@example.test')
    await page.locator('input[autocomplete="new-password"]').fill('SenhaSegura2026!')
    await page.getByRole('button',{name:/Criar minha loja/}).click()
    await page.waitForURL(success?/checkout\.stripe\.com\/c\/pay\//:/\/painel\/assinatura\?checkout=error/)
    assert.equal(registerCount,1,'Falha do Checkout não deve recriar a conta')
    assert.deepEqual({planCode:checkoutPayload.planCode,cycle:checkoutPayload.cycle,referralCode:checkoutPayload.referralCode},
      {planCode:'prata',cycle:'semiannual',referralCode:'SVP-12345'})
    if (!success) assert.match(page.url(),/plan=prata/)
    console.log(success?'SIGNUP_TO_STRIPE_AUTO_REDIRECT_OK':'SIGNUP_STRIPE_ERROR_FALLBACK_OK')
    await page.close()
  }
} finally { await browser.close() }
