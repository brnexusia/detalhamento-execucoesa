import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Click through the actual product editor against an isolated, mocked API.
const browser = await chromium.launch({ headless: true })
const general = { id:'catalogo-geral', slug:'geral', name:'Catálogo geral', kind:'geral',
  isDefault:true, active:true, explicitMembership:false, lockedByPlan:false, items:[] }
const store = { id:'store-sw', slug:'sw-moda', name:'SW Moda', eyebrow:'Atacado', tagline:'Coleção',
  minimum_order:0,whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',is_active:true,
  plan_tier:'ouro',onboarding_palette_selected:true }
const products = [
  { id:'prod-1', sku:'SW-4076',name:'Pantalona Celeste LUX Fluity',description:'Importada',
    price:89.9,catalogPrice:129.9 },
  { id:'prod-2', sku:'SW-4077',name:'Blusa Taly Fluity',description:'Importada',
    price:59.9,catalogPrice:79.9 },
].map(x=>({...x,category:'Geral',media_url:'',media_type:'image',images:[],
  variant_images:[],pack:'Grade P-M-G',variations:[],featured:false,active:true,
  stock_enabled:false,stock_quantity:0,variant_stock:{},retail_price:null,box_price:null,units_per_box:null}))
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const submitted=[]
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  await page.route('**/api/billing/status',route=>route.fulfill(json({required:false,accessGranted:true})))
  await page.route('**/api/admin/bootstrap*',route=>route.fulfill(json({
    user:{id:'user-1',name:'Lojista SW',email:'owner@example.test'},store,
    products:[],productCount:products.length,activeProductCount:products.length,
    productCategories:[{category:'Geral',count:products.length}],sellers:[],orders:[],
    stats:{views:0,carts:0,orders:0,value:0},
  })))
  await page.route('**/api/admin/catalogs',route=>route.fulfill(json({catalogs:[general],canCreateMultiple:true})))
  await page.route('**/api/admin/products/categories**',route=>route.fulfill(json({
    catalogId:general.id,total:products.length,categories:[{category:'Geral',count:products.length},{category:'Colar',count:4},{category:'Brincos',count:3}],
  })))
  await page.route('**/api/admin/products?*',route=>route.fulfill(json({
    products:products.map(p=>({...p})),pagination:{page:1,limit:18,total:products.length},
  })))
  await page.route('**/api/admin/plan-context',route=>route.fulfill(json({
    plan:{code:'ouro',name:'Ouro',limits:{photosPerProduct:20},features:{stock:false}},
    usage:{products:products.length,sellers:0,catalogs:1},
  })))
  await page.route('**/api/admin/imports*',route=>route.fulfill(json({jobs:[]})))
  await page.route(/\/api\/admin\/products\/[^/]+\/gallery$/,route=>route.fulfill(json({
    product:{id:route.request().url().split('/').at(-2),images:[]},limit:20,
  })))
  await page.route(/\/api\/admin\/products\/[^/]+$/,route=>{
    if(route.request().method()!=='PUT')return route.continue()
    const item=products.find(p=>p.id===route.request().url().split('/').at(-1))
    assert.ok(item,'Apenas produtos conhecidos da SW podem ser editados')
    const body=route.request().postDataJSON()
    submitted.push(body)
    item.category=body.category||'Geral'
    item.price=body.price
    item.variations=body.variations
    item.variant_prices=body.variantPrices
    if(body.catalogPrice!==undefined)item.catalogPrice=body.catalogPrice
    return route.fulfill(json({product:item}))
  })
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  const firstRow=page.locator('.svx-products .product-admin-card').filter({hasText:'Pantalona Celeste LUX Fluity'})
  await firstRow.waitFor({timeout:20000})
  assert.match(await firstRow.innerText(),/129,90/,'Importado exibe 129,90 na lista')
  await firstRow.getByRole('button',{name:'Editar'}).click()
  const editor=page.locator('.editor-modal')
  await editor.waitFor()
  const activePrice=editor.getByLabel('Preço exibido neste catálogo (R$)')
  assert.equal(await activePrice.inputValue(),'129.9','Editor precisa mostrar o preço da lista')
  assert.equal(await editor.getByLabel('Preço base (R$)').inputValue(),'89.9')
  await editor.getByRole('button',{name:/Categoria Geral/}).click()
  const categorySearch=editor.getByLabel('Buscar categoria')
  await categorySearch.fill('CÓLAR')
  await editor.getByRole('button',{name:'Colar',exact:true}).click()
  assert.equal(await editor.locator('.svx-category-trigger').innerText(),'Colar')
  await activePrice.fill('109.9')
  await editor.getByRole('button',{name:'Salvar produto'}).click()
  await editor.waitFor({state:'hidden'})
  await page.waitForFunction(()=>document.querySelector('.product-admin-card')?.textContent?.includes('109,90'),{timeout:15000})
  assert.equal(submitted[0]?.category,'Colar')
  assert.equal(submitted[0]?.catalogId,general.id)
  assert.equal(submitted[0]?.catalogPrice,109.9)
  assert.equal(submitted[0]?.price,89.9,'Editar catálogo não pode alterar preço base sem solicitação')

  await page.reload()
  const refreshed=page.locator('.svx-products .product-admin-card').filter({hasText:'Pantalona Celeste LUX Fluity'})
  await refreshed.waitFor({timeout:20000})
  assert.match(await refreshed.innerText(),/109,90/,'Preço atualizado persiste ao recarregar')

  const second=page.locator('.svx-products .product-admin-card').filter({hasText:'Blusa Taly Fluity'})
  await second.getByRole('button',{name:'Editar'}).click()
  const secondEditor=page.locator('.editor-modal')
  const secondPrice=secondEditor.getByLabel('Preço exibido neste catálogo (R$)')
  assert.equal(await secondPrice.inputValue(),'79.9')
  await secondEditor.getByRole('button',{name:/Categoria Geral/}).click()
  await secondEditor.getByLabel('Buscar categoria').fill('Colarr')
  await secondEditor.getByText('Você quis dizer?').waitFor()
  await secondEditor.getByRole('button',{name:'Colar',exact:true}).click()
  await secondPrice.fill('69.9')
  await secondEditor.getByRole('button',{name:'Salvar produto'}).click()
  await secondEditor.waitFor({state:'hidden'})
  assert.equal(submitted[1]?.catalogPrice,69.9)
  await second.getByRole('button',{name:'Editar'}).click()
  const pricing=page.locator('.editor-modal')
  await pricing.getByRole('button',{name:'Vários preços'}).click()
  await pricing.getByLabel('O que muda o preço?').selectOption('Embalagem')
  await pricing.getByLabel('Nome da opção 2',{exact:true}).fill('Pacote com 6 un.')
  await pricing.getByLabel('Nome da opção 3',{exact:true}).fill('Caixa fechada com 24 un.')
  for (const [i,price] of ['12','60','200'].entries()) await pricing.getByLabel('Preço da opção '+(i+1),{exact:true}).fill(price)
  await pricing.getByRole('button',{name:'Adicionar opção',exact:true}).click()
  await pricing.getByLabel('Nome da opção 4',{exact:true}).fill('Fardo')
  await pricing.getByLabel('Preço da opção 4',{exact:true}).fill('320')
  await pricing.getByRole('button',{name:'Salvar produto'}).click()
  await pricing.waitFor({state:'hidden'})
  assert.deepEqual(submitted[2].variantPrices,{group:'Embalagem',prices:{Unidade:12,'Pacote com 6 un.':60,'Caixa fechada com 24 un.':200,Fardo:320}})
  assert.deepEqual(submitted[2].variations,[{name:'Embalagem',options:['Unidade','Pacote com 6 un.','Caixa fechada com 24 un.','Fardo']}])
  await second.getByRole('button',{name:'Editar'}).click()
  await pricing.waitFor()
  assert.equal(await pricing.getByLabel('Preço da opção 3',{exact:true}).inputValue(),'200')
  assert.equal(await pricing.getByRole('button',{name:'Vários preços'}).getAttribute('aria-pressed'),'true')
  await page.setViewportSize({width:390,height:844})
  const overflow=await pricing.locator('.svx-price-editor').evaluate(el=>el.scrollWidth>el.clientWidth+2)
  assert.equal(overflow,false,'Editor de preços não pode ter rolagem horizontal no celular')
  console.log('SHOPVAX_SW_CATALOG_PRICE_COPY_EDIT_RELOAD_PASS')
} finally {
  await browser.close()
}
