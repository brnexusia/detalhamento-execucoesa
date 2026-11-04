import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y1lI7sAAAAASUVORK5CYII=', 'base64')
const bootstrap = {
  user:{id:'u1',email:'owner@example.test',name:'Ana'},
  store:{id:'s1',slug:'loja-teste',name:'Loja Teste',whatsapp:'5571999999999',
    onboarding_palette_selected:true,minimum_order:0,accent:'#F25C05',is_active:true,plan_tier:'bronze'},
  products:[],productCount:0,productCategories:[],sellers:[],orders:[],
  stats:{views:0,carts:0,orders:0,value:0},
}
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  await page.route('**/api/billing/status', r=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({required:false,accessGranted:true,status:'none',planCode:'bronze'})}))
  await page.route('**/api/admin/bootstrap*', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}))
  await page.route('**/api/admin/products?*', r=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({products:[],pagination:{page:1,limit:18,total:0}})}))
  await page.route('**/api/admin/plan-context', r=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({plan:{code:'bronze',name:'Bronze',limits:{photosPerProduct:5},features:{stock:false}},usage:{products:0,sellers:0,catalogs:1}})}))
  await page.route('**/api/admin/imports*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jobs:[]})}))
  await page.route('**/media/*',r=>r.fulfill({status:200,contentType:'image/png',body:png}))
  let count=0
  await page.route('**/api/admin/upload', r=>{
    count++
    if(count===2) return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Falha transitória no segundo arquivo.'})})
    return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({url:'/media/photo-'+count,type:'image'})})
  })
  let created=null, savedGallery=null
  await page.route('**/api/admin/products',r=>{
    created=r.request().postDataJSON()
    return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({product:{id:'p1'}})})
  })
  await page.route('**/api/admin/products/p1/gallery',r=>{
    savedGallery=r.request().postDataJSON()
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({product:{id:'p1',images:savedGallery.images},limit:5})})
  })
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  await page.getByRole('button',{name:'Novo produto'}).click()
  await page.locator('.editor-modal').waitFor()
  await page.locator('.product-inline-section input[type=file]').first().setInputFiles([
    {name:'primeira.png',mimeType:'image/png',buffer:png},
    {name:'falhou.png',mimeType:'image/png',buffer:png},
    {name:'terceira.png',mimeType:'image/png',buffer:png},
  ])
  await page.getByText(/2 foto\(s\) adicionada\(s\)/).waitFor({timeout:10000})
  assert.equal(count,3,'Os três arquivos devem ser tentados independentemente')
  assert.equal(await page.locator('.product-inline-gallery>div').count(),2,
    'Falha da segunda foto não pode descartar as fotos já enviadas')
  await page.locator('.product-inline-gallery>div').nth(1).getByRole('button',{name:'Mover foto para esquerda'}).click()
  await page.locator('.form-grid input').nth(0).fill('Blusa de teste')
  await page.locator('.form-grid input').nth(1).fill('59.90')
  await page.getByRole('button',{name:'Salvar produto'}).click()
  await page.waitForFunction(()=>!document.querySelector('.editor-modal'),null,{timeout:10000})
  assert.equal(created?.mediaUrl,'/media/photo-3','Capa deve respeitar reordenação da galeria')
  assert.deepEqual(savedGallery?.images,['/media/photo-3','/media/photo-1'])
  await page.close()
} finally { await browser.close() }
console.log('CATALOG_PHOTO_UPLOAD_BROWSER_OK')
