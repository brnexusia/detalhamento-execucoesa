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
  await page.route('**/api/admin/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)}))
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  await page.locator('.svx-products .product-admin-card').first().waitFor()
  assert.equal(await page.locator('.svx-products .product-admin-card').count(),3)
  await page.locator('.svx-products__categories button').filter({hasText:'Blusas'}).click()
  assert.equal(await page.locator('.svx-products .product-admin-card').count(),2)
  await page.locator('.svx-products .table-toolbar input').fill('Azul')
  assert.equal(await page.locator('.svx-products .product-admin-card').count(),1)
  await page.locator('.svx-products .table-toolbar input').fill('')
  await page.getByRole('button',{name:'Excluir em massa'}).click()
  assert.equal(await page.locator('.svx-products .product-select-control input').count(),2)
  console.log('PRODUCT_LIST_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
console.log('PRODUCT_LIST_TESTS_PASSED',3)
