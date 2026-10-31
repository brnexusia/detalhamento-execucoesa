import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const data={
  user:{id:'u1',name:'Ana Loja',email:'ana@example.test'},
  store:{id:'s1',slug:'sw-moda',name:'SW Moda',whatsapp:'5571999999999',plan_tier:'ouro',minimum_order:400,eyebrow:'Atacado',tagline:'Coleção',logo_url:'',accent:'#F25C05',is_active:true,onboarding_palette_selected:true},
  sellers:[{id:'seller1',name:'Carla',slug:'carla',phone:'5571999999999',is_active:true}],
  products:[],
  orders:[{
    id:'order-1',code:'AS-000041',store_id:'s1',seller_id:'seller1',total:119.80,
    items:[{productId:'p1',name:'Blusa',sku:'SW-22',quantity:2,unitPrice:59.9,lineTotal:119.8,selections:{Cor:'Grena',Tamanho:'P'}}],
    status:'whatsapp',buyer:{name:'Maria Silva',phone:'71999999999',city:'Salvador',cep:'41740100'},notes:'Entregar na loja',created_at:new Date().toISOString()
  }],
  stats:{views:1,carts:1,orders:1,value:119.80}
}
const browser=await chromium.launch({headless:true})
try {
  for (const [width,height] of [[320,568],[390,844],[1366,768]]) {
    const context=await browser.newContext({viewport:{width,height},permissions:['clipboard-read','clipboard-write']})
    const page=await context.newPage()
    const bootstrapRequests = []
    const failedApiResponses = []
    page.on('response',response=>{
      if (response.url().includes('/api/admin/') && !response.ok()) {
        failedApiResponses.push({url:response.url(),status:response.status()})
      }
    })
    page.on('pageerror',error=>failedApiResponses.push({pageError:error.message}))
    await page.route('**/api/admin/bootstrap*',route=>{
      const requestUrl = new URL(route.request().url())
      bootstrapRequests.push(requestUrl.pathname + requestUrl.search)
      assert.equal(requestUrl.pathname,'/api/admin/bootstrap')
      assert.equal(requestUrl.searchParams.get('compact'),'1','Painel deve usar bootstrap compacto')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        ...data, productCount:0, productCategories:[],
      })})
    })
    await page.goto('http://127.0.0.1:5173/painel/pedidos')
    await page.getByRole('button',{name:'Ver talão AS-000041'}).waitFor({state:'visible',timeout:10000})
      .catch(async error=>{throw new Error(
        'Talão ausente: '+JSON.stringify({bootstrapRequests,failedApiResponses,body:(await page.locator('body').innerText()).slice(0,1500)}),
        {cause:error},
      )})
    assert.ok(bootstrapRequests.length>0,'Mock do bootstrap compacto precisa interceptar a requisição')
    assert.deepEqual(failedApiResponses,[],'Painel não pode gerar erros de API ou React')
    await page.getByRole('button',{name:'Ver talão AS-000041'}).click()
    const section=page.getByRole('region',{name:'Dados do comprador e observações'})
    await section.waitFor()
    assert.match(await section.innerText(),/Maria Silva/)
    assert.match(await section.innerText(),/Salvador/)
    assert.match(await section.innerText(),/71999999999/)
    assert.match(await section.innerText(),/Entregar na loja/)
    await page.getByRole('button',{name:'Copiar talão'}).click()
    const copied=await page.evaluate(()=>navigator.clipboard.readText())
    assert.match(copied,/Comprador: Maria Silva/)
    assert.match(copied,/Cidade: Salvador/)
    assert.match(copied,/Observações: Entregar na loja/)
    console.log('ORDER_BUYER_DETAIL_PASS',width,height)
    await context.close()
  }
} finally {await browser.close()}
console.log('ORDER_BUYER_DETAIL_TESTS_PASSED',3)
