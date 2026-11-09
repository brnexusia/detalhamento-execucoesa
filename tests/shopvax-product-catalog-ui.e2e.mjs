import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base=process.env.BUYER_UI_BASE||'http://127.0.0.1:5173'
const data={
 user:{id:'owner-ux',name:'Lojista Teste',email:'loja@example.test'},
 store:{id:'store-ux',slug:'loja-ux',name:'Loja UX',accent:'#F25C05',plan_tier:'ouro',whatsapp:'5511999999999',onboarding_palette_selected:true},
 products:[],productCount:100,activeProductCount:95,productCategories:[{category:'Bolsas',count:100}],
 sellers:[],orders:[],stats:{value:0},
}
const general={id:'catalog-geral',slug:'geral',name:'Catálogo principal',kind:'geral',minimumOrder:null,isDefault:true,active:true,lockedByPlan:false,explicitMembership:false,items:[]}
const retail={...general,id:'catalog-varejo',slug:'varejo',name:'Minha Vitrine',kind:'varejo',isDefault:false,explicitMembership:true}
const products=Array.from({length:18},(_,i)=>({
 id:'product-'+(i+1),name:'Bolsa '+(i+1),sku:'R'+(i+1),description:'',price:29.99,category:'Bolsas',media_url:'',
 media_type:'image',variations:[],images:[],featured:false,active:true,pack:'',stock_enabled:false,stock_quantity:0,variant_stock:{}
}))
const browser=await chromium.launch({headless:true})
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
mkdirSync('artifacts/shopvax-products',{recursive:true})
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390})
  const page=await context.newPage()
  await page.route('**/api/billing/status',r=>r.fulfill(json({required:false,accessGranted:true})))
  await page.route('**/api/admin/bootstrap?compact=1',r=>r.fulfill(json(data)))
  await page.route('**/api/admin/catalogs',r=>r.fulfill(json({catalogs:[general,retail],canCreateMultiple:true})))
  await page.route('**/api/admin/products?**',r=>{
    const url=new URL(r.request().url())
    const current=url.searchParams.get('catalogId')||general.id
    const list=current===retail.id?products.slice(0,1):products
    return r.fulfill(json({products:list,pagination:{page:1,limit:18,total:current===retail.id?1:100}}))
  })
  await page.goto(base+'/painel/produtos',{waitUntil:'domcontentloaded'})
  await page.getByRole('heading',{name:'Produtos',exact:true}).waitFor({timeout:30000})
  await page.getByRole('button',{name:'Catálogo principal'}).waitFor({timeout:30000})
  assert.equal(await page.getByText('Catálogos e pedidos mínimos').count(),0,'Painel de administração de catálogos não pode existir inline')
  await page.getByRole('button',{name:'Selecionar produtos'}).click()
  await page.getByRole('button',{name:/Selecionar todos os 100 resultados/}).waitFor()
  await page.getByRole('button',{name:/Selecionar todos os 100 resultados/}).click()
  assert.match(await page.locator('.product-bulk-toolbar').innerText(),/100 selecionado/)
  await page.getByRole('button',{name:'Cancelar seleção'}).click()
  await page.getByRole('button',{name:'Minha Vitrine'}).click()
  await page.waitForFunction(()=>document.querySelectorAll('.product-admin-card').length===1)
  await page.getByRole('button',{name:'Esvaziar catálogo'}).waitFor()
  await page.getByRole('button',{name:/Criar catálogo/}).click()
  const createDialog=page.getByRole('dialog',{name:'Criar catálogo'})
  await createDialog.waitFor()
  const typeSelect=createDialog.getByLabel('Tipo')
  const options=await typeSelect.locator('option').allTextContents()
  assert.deepEqual(options.map(x=>x.trim()),['Varejo','Atacado','Caixa fechada','Personalizado'])
  await typeSelect.selectOption('personalizado')
  await createDialog.getByLabel('Nome do tipo personalizado').fill('Consignado')
  await createDialog.getByLabel('Qual preço utilizar?').selectOption('caixa_fechada')
  assert.equal(await createDialog.getByLabel('Nome do tipo personalizado').inputValue(),'Consignado')
  await page.getByRole('button',{name:'Fechar'}).last().click()
  await page.getByRole('button',{name:'Catálogo principal'}).click()
  await page.getByRole('button',{name:'Excluir tudo da loja'}).click()
  await page.getByRole('dialog',{name:/Excluir todos os produtos/}).waitFor()
  assert.match(await page.getByRole('dialog').innerText(),/EXCLUIR TUDO/)
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.screenshot({path:'artifacts/shopvax-products/catalog-tabs-'+width+'.png',fullPage:true})
  const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}))
  assert.ok(dimensions.width<=dimensions.viewport+2,'Sem rolagem horizontal do painel: '+JSON.stringify(dimensions))
  console.log('SHOPVAX_PRODUCT_CATALOG_COMPACT_UX_OK',width)
  await context.close()
 }
}finally{await browser.close()}
