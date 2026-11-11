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
const retailProducts=[{...products[0],category:'Bijuterias'}]
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
  await page.route('**/api/admin/products/categories**',r=>{
    const catalogId=new URL(r.request().url()).searchParams.get('catalogId')||general.id
    const body=catalogId===retail.id
      ? {catalogId:retail.id,total:1,categories:[{category:'Bijuterias',count:1}]}
      : {catalogId:general.id,total:100,categories:[{category:'Bolsas',count:100}]}
    return r.fulfill(json(body))
  })
  await page.route('**/api/admin/products?**',r=>{
    const url=new URL(r.request().url())
    const current=url.searchParams.get('catalogId')||general.id
    const list=current===retail.id?retailProducts:products
    return r.fulfill(json({products:list,pagination:{page:1,limit:18,total:current===retail.id?1:100}}))
  })
  await page.goto(base+'/painel/produtos',{waitUntil:'domcontentloaded'})
  await page.getByRole('heading',{name:'Produtos',exact:true}).waitFor({timeout:30000})
  await page.getByRole('button',{name:'Catálogo principal'}).waitFor({timeout:30000})
  await page.getByRole('heading',{name:'Meus catálogos'}).waitFor()
  await page.locator('.svx-products__categories').getByRole('button',{name:/Todos 100/}).waitFor()
  assert.equal(await page.locator('.svx-products__categories').getByRole('button',{name:/Bolsas 100/}).count(),1)
  const catalogCards=page.locator('.svx-catalog-card')
  assert.equal(await catalogCards.count(),2,'Catálogos da mesma loja precisam ter cartões e URLs individuais')
  const retailCard=catalogCards.filter({has:page.getByRole('button',{name:'Minha Vitrine'})})
  const generalCard=catalogCards.filter({has:page.getByRole('button',{name:'Catálogo principal'})})
  assert.equal(await generalCard.locator('input[readonly]').inputValue(),base+'/loja-ux?catalog=geral')
  assert.equal(await retailCard.locator('input[readonly]').inputValue(),base+'/loja-ux?catalog=varejo')
  assert.equal(await retailCard.getByRole('link',{name:'Abrir catálogo'}).getAttribute('href'),base+'/loja-ux?catalog=varejo')
  assert.equal(await retailCard.getByRole('button',{name:'Copiar link'}).count(),1)
  assert.equal(await page.getByText('Catálogos e pedidos mínimos').count(),0,'Não deve existir o antigo painel inline')
  await page.getByRole('button',{name:'Selecionar produtos'}).click()
  await page.getByRole('button',{name:/Selecionar todos os 100 resultados/}).waitFor()
  await page.getByRole('button',{name:/Selecionar todos os 100 resultados/}).click()
  assert.match(await page.locator('.product-bulk-toolbar').innerText(),/100 selecionado/)
  await page.getByRole('button',{name:'Excluir tudo da loja'}).waitFor()
  await page.getByRole('button',{name:'Cancelar seleção'}).click()
  assert.equal(await page.getByRole('button',{name:'Excluir tudo da loja'}).count(),0)
  await page.getByRole('button',{name:'Minha Vitrine'}).click()
  await page.locator('.svx-products__categories').getByRole('button',{name:/Todos 1/}).waitFor()
  assert.equal(await page.locator('.svx-products__categories').getByRole('button',{name:/Bolsas/}).count(),0,'Categoria exclusiva da outra vitrine não pode aparecer')
  assert.equal(await page.locator('.svx-products__categories').getByRole('button',{name:/Bijuterias 1/}).count(),1)
  await page.waitForFunction(()=>document.querySelectorAll('.product-admin-card').length===1)
  assert.equal(await page.getByRole('button',{name:'Esvaziar catálogo'}).count(),0,'Esvaziar requer seleção total explícita')
  await page.getByRole('button',{name:'Selecionar produtos'}).click()
  await page.getByRole('button',{name:/Selecionar todos os 1 resultados/}).click()
  await page.getByRole('button',{name:'Esvaziar catálogo'}).waitFor()
  await page.getByRole('button',{name:'Cancelar seleção'}).click()
  await page.getByRole('button',{name:/Criar catálogo/}).click()
  const createDialog=page.getByRole('dialog',{name:'Criar catálogo'})
  await createDialog.waitFor()
  const typeSelect=createDialog.getByLabel('Tipo')
  const options=await typeSelect.locator('option').allTextContents()
  assert.deepEqual(options.map(x=>x.trim()),['Varejo','Atacado','Alto Atacado','Personalizado'])
  await typeSelect.selectOption('alto_atacado')
  assert.match(await createDialog.innerText(),/preço principal por unidade/)
  await typeSelect.selectOption('personalizado')
  const format=createDialog.getByLabel('Formato personalizado')
  assert.deepEqual((await format.locator('option').allTextContents()).map(x=>x.trim()),
    ['Selecione um formato','Caixa fechada','Pacote','6 unidades','Outro formato'])
  await format.selectOption('Pacote')
  assert.equal(await format.inputValue(),'Pacote')
  await format.selectOption('6 unidades')
  assert.equal(await format.inputValue(),'6 unidades')
  await format.selectOption('Caixa fechada')
  assert.equal(await createDialog.getByLabel('Qual preço utilizar?').inputValue(),'caixa_fechada')
  await format.selectOption('outro')
  await createDialog.getByLabel('Nome do tipo personalizado').fill('Consignado')
  assert.equal(await format.inputValue(),'outro')
  assert.equal(await createDialog.getByLabel('Nome do tipo personalizado').inputValue(),'Consignado')
  await page.getByRole('button',{name:'Fechar'}).last().click()
  await page.getByRole('button',{name:'Catálogo principal'}).click()
  await page.locator('.svx-products__categories').getByRole('button',{name:/Todos 100/}).waitFor()
  assert.equal(await page.locator('.svx-products__categories').getByRole('button',{name:/Bijuterias/}).count(),0,'Categorias da vitrine secundária não podem vazar')
  await page.getByRole('button',{name:'Selecionar produtos'}).click()
  await page.getByRole('button',{name:/Selecionar todos os 100 resultados/}).click()
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
