import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y1lI7sAAAAASUVORK5CYII=', 'base64')
const item = {
  id:'p-existing',sku:'REF-1',name:'Blusa existente',description:'Produto real',
  category:'Blusas',price:59.90,media_url:'/media/existing',media_type:'image',
  images:['/media/existing'],variant_images:[],pack:'',variations:[],featured:false,
  active:true,stock_enabled:false,stock_quantity:0,variant_stock:{},
}
const bootstrap = {
  user:{id:'u1',name:'Loja Teste',email:'owner@example.test'},
  store:{id:'s1',slug:'loja-teste',name:'Loja Teste',whatsapp:'5571999999999',
    onboarding_palette_selected:true,minimum_order:0,accent:'#F25C05',is_active:true,plan_tier:'bronze'},
  products:[],productCount:1,productCategories:[{category:'Blusas',count:1}],
  sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},
}
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const fulfillJson=(route,body)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  await page.route('**/api/billing/status',r=>fulfillJson(r,{required:false,accessGranted:true,status:'none',planCode:'bronze'}))
  await page.route('**/api/admin/bootstrap*',r=>fulfillJson(r,bootstrap))
  await page.route('**/api/admin/products?*',r=>fulfillJson(r,{products:[item],pagination:{page:1,limit:18,total:1}}))
  await page.route('**/api/admin/plan-context',r=>fulfillJson(r,{
    plan:{code:'bronze',name:'Bronze',limits:{photosPerProduct:5},features:{stock:false}},usage:{products:1,sellers:0,catalogs:1},
  }))
  await page.route('**/api/admin/imports*',r=>fulfillJson(r,{jobs:[]}))
  await page.route('**/media/*',r=>r.fulfill({status:200,contentType:'image/png',body:png}))
  let uploads=0,appends=0,productUpdates=0,galleryPatches=0
  await page.route('**/api/admin/upload',r=>{
    uploads++
    return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({url:'/media/new-photo',type:'image'})})
  })
  await page.route('**/api/admin/products/p-existing/gallery/photos',r=>{
    appends++
    assert.equal(r.request().method(),'POST')
    assert.equal(r.request().postDataJSON().url,'/media/new-photo')
    item.images.push('/media/new-photo')
    return fulfillJson(r,{product:{id:item.id,images:item.images,media_url:item.media_url,media_type:'image'},limit:5,added:true})
  })
  await page.route('**/api/admin/products/p-existing/gallery',r=>{
    galleryPatches++
    return fulfillJson(r,{product:{id:item.id,images:item.images},limit:5})
  })
  await page.route('**/api/admin/products/p-existing',r=>{
    productUpdates++
    return fulfillJson(r,{product:item})
  })
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  await page.locator('.svx-products__edit').first().click()
  await page.locator('.editor-modal').waitFor()
  assert.equal(await page.locator('.product-inline-gallery > div').count(),1)
  await page.locator('.product-inline-section input[type=file]').first().setInputFiles({name:'nova-foto.png',mimeType:'image/png',buffer:png})
  await page.getByText('1 foto(s) adicionada(s) e salva(s) neste produto.').waitFor({timeout:15000})
  assert.equal(await page.locator('.product-inline-gallery > div').count(),2)
  assert.equal(uploads,1)
  assert.equal(appends,1)
  assert.equal(galleryPatches,0,'Upload em produto existente não deve depender do botão Salvar produto')
  assert.equal(productUpdates,0,'Upload não deve sobrescrever campos do produto')
  await page.locator('.editor-modal header button[aria-label="Fechar"]').click()
  await page.locator('.editor-modal').waitFor({state:'detached'})
  await page.locator('.svx-products__edit').first().click()
  await page.locator('.editor-modal').waitFor()
  assert.equal(await page.locator('.product-inline-gallery > div').count(),2,'Ao reabrir deve ter a foto já salva')
  await page.close()
} finally {
  await browser.close()
}
console.log('EXISTING_PRODUCT_GALLERY_APPEND_BROWSER_OK')
