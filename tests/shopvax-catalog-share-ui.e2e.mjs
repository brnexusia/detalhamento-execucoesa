import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({headless:true})
const general={id:'cat-geral',slug:'geral',name:'Catálogo geral',kind:'geral',isDefault:true,active:true,lockedByPlan:false}
const colares={id:'cat-colares',slug:'colares',name:'Colares da coleção',kind:'varejo',isDefault:false,active:true,lockedByPlan:false}
const store={id:'store-1',slug:'mama',name:'Mama Acessórios',plan_tier:'ouro',is_active:true,
  minimum_order:0,whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',onboarding_palette_selected:true}
const response=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)})
try {
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}})
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedCatalogLink=value}}})
    })
    await page.route('**/api/billing/status',r=>r.fulfill(response({required:false,accessGranted:true})))
    await page.route('**/api/admin/bootstrap*',r=>r.fulfill(response({
      user:{id:'user-1',name:'Dona da loja',email:'owner@example.test'},
      store,products:[],productCount:0,activeProductCount:0,productCategories:[],
      sellers:[{id:'seller-1',slug:'maria',name:'Maria',phone:'5571999999999',is_active:true}],
      orders:[],stats:{views:0,carts:0,orders:0,value:0},
    })))
    await page.route('**/api/admin/catalogs',r=>r.fulfill(response({catalogs:[general,colares],canCreateMultiple:true})))
    await page.route('**/api/admin/products/categories**',r=>r.fulfill(response({catalogId:general.id,total:0,categories:[]})))
    await page.route('**/api/admin/products?*',r=>r.fulfill(response({products:[],pagination:{page:1,limit:18,total:0}})))
    await page.route('**/api/admin/plan-context',r=>r.fulfill(response({plan:{code:'ouro',name:'Ouro',limits:{photosPerProduct:20},features:{stock:false}},usage:{products:0,sellers:1,catalogs:2}})))
    await page.route('**/api/admin/imports*',r=>r.fulfill(response({jobs:[]})))
    await page.goto('http://127.0.0.1:5173/painel/produtos')
    await page.getByRole('button',{name:'Colares da coleção',exact:true}).click()
    const section=page.getByRole('region',{name:'Links de divulgação'})
    await section.waitFor()
    const cards=section.locator('.svx-catalog-share__card')
    assert.equal(await cards.count(),2)
    assert.match(await cards.first().innerText(),/Link geral da loja/)
    assert.equal(await cards.first().getByRole('link',{name:'Abrir'}).getAttribute('href'),'https://shopvax.com.br/mama')
    assert.equal(await cards.last().getByRole('link',{name:'Abrir'}).getAttribute('href'),'https://shopvax.com.br/mama/catalogo/colares')
    await cards.last().getByRole('button',{name:'Copiar'}).click()
    assert.equal(await page.evaluate(()=>window.__copiedCatalogLink),'https://shopvax.com.br/mama/catalogo/colares')
    await section.getByLabel('Vendedora do link').selectOption('maria')
    assert.match(await cards.first().innerText(),/Link da vendedora/)
    assert.equal(await cards.first().getByRole('link',{name:'Abrir'}).getAttribute('href'),'https://shopvax.com.br/mama/maria')
    assert.equal(await cards.last().getByRole('link',{name:'Abrir'}).getAttribute('href'),'https://shopvax.com.br/mama/maria/colares')
    await cards.last().getByRole('button',{name:'Copiar'}).click()
    assert.equal(await page.evaluate(()=>window.__copiedCatalogLink),'https://shopvax.com.br/mama/maria/colares')
    const overflow=await section.evaluate(el=>el.scrollWidth>el.clientWidth+2)
    assert.equal(overflow,false,'Cards não podem criar scroll horizontal em '+width)
    console.log('SHOPVAX_CATALOG_SHARING_UI_PASS',width)
    await page.close()
  }
} finally {await browser.close()}
