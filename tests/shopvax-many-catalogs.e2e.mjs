import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// The products page must open on the entire store database, without a full
// catalog directory or link-sharing cards pushing the products below the fold.
const browser = await chromium.launch({headless:true})
const json = body => ({status:200,contentType:'application/json',body:JSON.stringify(body)})
const general = {id:'catalog-general',slug:'geral',name:'Catálogo Brincos',kind:'geral',minimumOrder:null,isDefault:true,active:true,lockedByPlan:false,explicitMembership:false}
const catalogs = [general,...Array.from({length:21},(_,i)=>({
  ...general,id:'cat-'+(i+1),slug:'cat-'+(i+1),name:'Catálogo '+String(i+1).padStart(2,'0'),
  kind:'varejo',isDefault:false,explicitMembership:true,
}))]
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:850},isMobile:width===390,hasTouch:width===390})
    const page = await context.newPage()
    const scopes = []
    await page.route('**/api/billing/status', route=>route.fulfill(json({required:false,accessGranted:true})))
    await page.route('**/api/admin/bootstrap?compact=1',route=>route.fulfill(json({
      user:{id:'owner',name:'Teste',email:'owner@example.test'},
      store:{id:'store',name:'Mama',slug:'mama-acessorios',plan_tier:'ouro',accent:'#F25C05',whatsapp:'5571999999999',onboarding_palette_selected:true},
      products:[],productCount:0,activeProductCount:0,productCategories:[],sellers:[],orders:[],stats:{value:0},
    })))
    await page.route('**/api/admin/catalogs',route=>route.fulfill(json({catalogs,canCreateMultiple:true})))
    await page.route('**/api/admin/products/categories**',route=>{
      const catalogId=new URL(route.request().url()).searchParams.get('catalogId')
      return route.fulfill(json({catalogId,total:0,categories:[]}))
    })
    await page.route('**/api/admin/products?**',route=>{
      const catalogId=new URL(route.request().url()).searchParams.get('catalogId')
      scopes.push(catalogId)
      return route.fulfill(json({products:[],pagination:{page:1,limit:18,total:0}}))
    })
    await page.goto('http://127.0.0.1:5173/painel/produtos')
    await page.getByRole('button',{name:/Escolher uma pasta/}).waitFor({timeout:20000})
    await page.waitForFunction(()=>document.querySelector('.svx-products__toolbar')!==null)
    await page.waitForTimeout(150)
    assert.ok(scopes.includes(null),'A página deve buscar a base toda por padrão')
    assert.equal(await page.locator('.svx-catalog-folder').count(),0,'Não exibir os 22 catálogos antes de abrir a lista')
    assert.equal(await page.locator('.svx-catalog-folder-details').count(),0,'Não expandir links e detalhes automaticamente')
    assert.equal(await page.getByRole('button',{name:/Todos os produtos/}).getAttribute('aria-pressed'),'true')
    assert.equal(await page.getByRole('button',{name:/Todas as categorias/}).count(),1,'Filtro de categoria deve ser distinto do filtro de catálogo')

    await page.getByRole('button',{name:/Escolher uma pasta/}).click()
    const folders=page.locator('.svx-catalog-folder')
    assert.equal(await folders.count(),12,'Limitar a lista aberta a 12 pastas')
    assert.equal(await page.locator('.svx-catalog-folders.is-compact').count(),1)
    await page.getByRole('button',{name:'Próxima página das pastas'}).click()
    assert.equal(await folders.count(),10,'Segunda página com 10 pastas')
    assert.match(await page.locator('.svx-catalog-pagination').innerText(),/Página 2 de 2/)
    await page.getByLabel('Buscar pastas').fill('CATALOGO 21')
    assert.equal(await folders.count(),1,'Busca de catálogos deve ignorar acentos')
    const filteredResponse=page.waitForResponse(resp=>resp.url().includes('/api/admin/products?') && new URL(resp.url()).searchParams.get('catalogId')==='cat-21')
    await page.getByRole('button',{name:'Catálogo 21',exact:true}).click()
    await filteredResponse
    assert.equal(await folders.count(),0,'A lista deve recolher após a escolha')
    assert.match(await page.locator('.svx-catalog-quickbar__folders').innerText(),/CATÁLOGO 21/i)
    assert.equal(await page.locator('.svx-catalog-folder-details').count(),0,'Links ocultos até clicar no botão')
    await page.getByRole('button',{name:/Links e detalhes/}).click()
    assert.match(await page.locator('.svx-catalog-folder-details h3').innerText(),/CATÁLOGO 21/)
    await page.getByRole('button',{name:/Links e detalhes/}).click()
    assert.equal(await page.locator('.svx-catalog-folder-details').count(),0)

    const unfilteredResponse=page.waitForResponse(resp=>resp.url().includes('/api/admin/products?') && !new URL(resp.url()).searchParams.has('catalogId'))
    await page.getByRole('button',{name:/Ver todos os produtos/}).click()
    await unfilteredResponse
    assert.equal(await page.locator('.svx-catalog-quickbar__all').getAttribute('aria-pressed'),'true')
    assert.equal(await page.locator('.svx-catalog-folder').count(),0)
    const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)
    assert.equal(noOverflow,true,'Sem rolagem horizontal em '+width)
    console.log('SHOPVAX_MANY_CATALOGS_UX_PASS',width)
    await context.close()
  }
} finally {
  await browser.close()
}
