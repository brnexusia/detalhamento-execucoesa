import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdirSync} from 'node:fs'

/* Prancha 03: coleção -> escolha de peça -> grade/quantidade -> talão ->
   revisão -> pedido preparado -> ação EXPLÍCITA de abrir WhatsApp.
   Nunca tratar link aberto como venda/mensagem enviada. */
const product={id:'p1',sku:'SW-444',name:'CALÇA PANTALONA MAIA',description:'Calça de verão em tecido fluity',price:59.90,category:'Calças',mediaUrl:'',mediaType:'image',images:[],variations:[{name:'Cor',options:['Azteca','Carrara']},{name:'Tamanho',options:['P','M','G']}],stockQuantity:100}
const payload={store:{slug:'sw-moda',name:'SW MODA FEMININA',minimumOrder:150,whatsapp:'5571999999999',accent:'#F25C05'},seller:{slug:'carla',name:'Carla',phone:'5571999999999'},products:[product],categories:['Calças'],page:{hasMore:false}}
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,568],[390,844],[430,932]]){
  const context=await browser.newContext({viewport:{width,height}})
  const page=await context.newPage()
  let created
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await context.route('**/api/business/orders**',r=>{created=r.request().postDataJSON();return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({orderId:'order-01',code:'AS-1047',whatsappUrl:'https://wa.me/5571999999999?text=pedido-pronto'})})})
  await page.goto('http://127.0.0.1:5173/sw-moda')
  await page.locator('.product-grid').waitFor()
  await page.screenshot({path:'artifacts/shopvax-redesign/flow-03-catalog-'+width+'.png'})
  await page.locator('.product-card__media').first().click()
  await page.locator('.product-picker').waitFor()
  assert(await page.locator('.svx-grade').isVisible(),'Cor/Tamanho deve abrir na grade')
  await page.getByRole('button',{name:'Uma variação'}).click()
  await page.getByRole('button',{name:'Azteca',exact:true}).last().click()
  await page.getByRole('button',{name:'P',exact:true}).last().click()
  await page.locator('.picker-add').click()
  await page.locator('.product-picker').waitFor({state:'detached'})
  await page.locator('.topbar .cart-trigger').click()
  assert.match(await page.locator('.minimum-box').innerText(),/Faltam|90,10/)
  assert.equal(await page.getByRole('button',{name:/Revisar talão/}).isDisabled(),true,'Minimum must block checkout')
  await page.locator('.cart-drawer__head button').click()
  await page.locator('.product-card__media').first().click()
  assert(await page.locator('.svx-grade').isVisible(),'Reabrir produto deve preservar grade padrão')
  await page.getByRole('button',{name:'Uma variação'}).click()
  await page.getByRole('button',{name:'Azteca',exact:true}).last().click()
  await page.getByRole('button',{name:'P',exact:true}).last().click()
  await page.locator('.product-picker .quantity-control--large button[aria-label="Aumentar quantidade"]').click()
  await page.locator('.product-picker .quantity-control--large button[aria-label="Aumentar quantidade"]').click()
  await page.locator('.picker-add').click()
  await page.locator('.topbar .cart-trigger').click()
  assert.match(await page.locator('.minimum-box').innerText(),/Pedido mínimo atingido/)
  assert.equal(await page.locator('.svx-minimum-segments i.is-filled').count(),20,'Minimum must fill segments')
  await page.screenshot({path:'artifacts/shopvax-redesign/flow-03-minimum-'+width+'.png'})
  await page.getByRole('button',{name:/Revisar talão/}).click()
  await page.locator('.svx-review__footer').waitFor()
  await page.screenshot({path:'artifacts/shopvax-redesign/flow-03-review-'+width+'.png'})
  await page.getByRole('button',{name:/Preparar pedido para enviar/}).click()
  await page.locator('.svx-order-ready').waitFor()
  assert(created,'Buyer has explicitly prepared the order')
  assert.equal(created.items[0].quantity,4)
  assert.equal(created.items[0].selections.Cor,'Azteca')
  assert.match(await page.locator('.svx-order-ready').innerText(),/agora é só enviar/i)
  assert.match(await page.locator('.svx-order-ready').innerText(),/não confirma entrega da mensagem|não confirma/i)
  await page.screenshot({path:'artifacts/shopvax-redesign/flow-03-order-ready-'+width+'.png'})
  const count=await page.locator('.svx-order-ready__send').count()
  assert.equal(count,1,'WhatsApp should open only upon explicit click')
  await context.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_FLOW_LAYER_03_OK')
