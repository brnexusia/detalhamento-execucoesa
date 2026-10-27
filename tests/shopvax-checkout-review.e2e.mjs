import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const product={ id:'checkout-01',sku:'SV-021',name:'Blusa Lisa',description:'Produto teste',price:59.9,category:'Blusas',mediaUrl:'',mediaType:'image',images:[],variations:[{name:'Cor',options:['Preta']},{name:'Tamanho',options:['M']}] }
const payload={ store:{slug:'sw-moda',name:'SW Moda',eyebrow:'Atacado',tagline:'Coleção',minimumOrder:50,whatsapp:'5571999999999',accent:'#F25C05'},seller:{slug:'marina',name:'Marina',phone:'5571999999999'},products:[product],categories:['Blusas'],page:{hasMore:false,nextCursor:null,limit:24} }
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,568],[390,844],[1366,768]]){
  const context=await browser.newContext({viewport:{width,height},permissions:['clipboard-read','clipboard-write']})
  const page=await context.newPage()
  let created=null
  page.on('request',request => {if(request.url().includes('/api/'))console.log('API_REQUEST',request.method(),request.url())})
  page.on('requestfailed',request=>console.log('REQUEST_FAILED',request.url(),request.failure()))
  page.on('pageerror',error=>console.log('PAGE_ERROR',error.message))
  page.on('console',message=>{if(message.type()==='error')console.log('BROWSER_CONSOLE_ERROR',message.text())})
  await page.route('**/api/public/store/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',route=>route.fulfill({status:204,body:''}))
  await context.route('**/api/business/orders**',route=>{created=route.request().postDataJSON();return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({orderId:'order-review-01',code:'AS-001',whatsappUrl:'https://wa.me/5571999999999?text=teste'})})})
  page.on('request',req=>{if(req.method()==='POST')console.log('REQUEST_DEBUG',req.url())})
  page.on('response',res=>{if(res.request().method()==='POST')console.log('RESPONSE_DEBUG',res.url(),res.status())})
  await context.route('https://wa.me/**',route=>route.fulfill({status:200,body:'ok'}))
  await page.goto('http://127.0.0.1:5173/sw-moda')
  await page.locator('.product-card__media').first().click()
  await page.locator('.picker-add').click()
  await page.locator('.cart-trigger').click()
  await page.getByRole('button',{name:/Revisar talão/}).click()
  await page.locator('.svx-review-layer').waitFor()
  await page.locator('.svx-review__buyer-toggle').click()
  await page.getByPlaceholder('Seu nome').fill('Compradora Teste')
  await page.getByPlaceholder('DDD + número').fill('71999999999')
  await page.getByPlaceholder('Sua cidade').fill('Salvador')
  await page.getByPlaceholder('00000-000').fill('41740100')
  await page.getByPlaceholder('Ex.: separar outras cores, retirada na loja...').fill('Retirar na loja')
  await page.getByRole('button',{name:/Preparar pedido para enviar/}).click()
  await page.waitForTimeout(800)
  const state=await page.evaluate(()=>({ reviewOpen:!!document.querySelector('.svx-review'), error:document.querySelector('.svx-review .form-error')?.textContent||'', location:location.href }))
  console.log('CHECKOUT_DEBUG',width,height,JSON.stringify({state,created}))
  assert(created, 'a solicitação de registro do pedido deve ser enviada')
  assert.equal(state.error,'','o checkout não deve apresentar erro')
  assert.equal(state.reviewOpen,false,'o checkout deve fechar após preparar o talão')
  await page.locator('.svx-order-ready').waitFor()
  assert.match(await page.locator('.svx-order-ready').innerText(),/Agora é só enviar/)
  await page.getByRole('button',{name:'Copiar pedido'}).click()
  await page.getByRole('button',{name:'Mensagem copiada'}).waitFor()
  assert(created,'deve registrar pedido na API')
  assert.equal(created.buyer.name,'Compradora Teste')
  assert.equal(created.buyer.cep,'41740100')
  assert.equal(created.notes,'Retirar na loja')
  assert.equal(created.items[0].quantity,1)
  console.log('CHECKOUT_REVIEW_PASS',width,height)
  await context.close()
 }
}finally{await browser.close()}
console.log('CHECKOUT_REVIEW_TESTS_PASSED',3)
