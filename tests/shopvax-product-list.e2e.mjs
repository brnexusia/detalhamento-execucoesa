import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const product=(id,name,category,price)=>({id,sku:'REF-'+id,name,description:'Peça cadastrada',category,price,media_url:'',media_type:'image',images:[],variant_images:[],pack:'',variations:[],featured:false,active:true,stock_enabled:false,stock_quantity:0,variant_stock:{}})
const data={
 user:{id:'u1',email:'loja@example.test',name:'Ana Teste'},
 store:{id:'s1',slug:'sw-moda',name:'SW Moda',eyebrow:'Atacado',tagline:'Coleção',minimum_order:0,whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',is_active:true,plan_tier:'prata',onboarding_palette_selected:true},
 products:[product('01','Blusa Grena','Blusas',59.9),product('02','Calça Preta','Calças',109.9),product('03','Blusa Azul','Blusas',69.9)],
 sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},
}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,568],[390,844],[1440,900]]){
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/admin/bootstrap*',r=>r.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({ ...data, products:[], productCount:data.products.length,
      productCategories:[{category:'Blusas',count:2},{category:'Calças',count:1}] }),
  }))
  await page.route('**/api/admin/products?*', r => {
    const url = new URL(r.request().url())
    const q = (url.searchParams.get('q') || '').toLowerCase()
    const category = url.searchParams.get('category') || 'Todas'
    const limit = Number(url.searchParams.get('limit') || 18)
    const pageNumber = Number(url.searchParams.get('page') || 1)
    const filtered = data.products.filter(item =>
      (category === 'Todas' || item.category === category) &&
      [item.name,item.sku,item.category].join(' ').toLowerCase().includes(q))
    r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({products:filtered.slice((pageNumber-1)*limit,pageNumber*limit),
        pagination:{page:pageNumber,limit,total:filtered.length}})})
  })
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  await page.locator('.svx-products .product-admin-card').first().waitFor()
  assert.equal(await page.locator('.svx-products .product-admin-card').count(),3)
  await page.locator('.svx-products__categories button').filter({hasText:'Blusas'}).click()
  await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 2)
  await page.locator('.svx-products .table-toolbar input').fill('Azul')
  await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 1)
  await page.locator('.svx-products .table-toolbar input').fill('')
  await page.getByRole('button',{name:'Excluir em massa'}).click()
  await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-select-control input').length === 2)
  console.log('PRODUCT_LIST_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
console.log('PRODUCT_LIST_TESTS_PASSED',3)
