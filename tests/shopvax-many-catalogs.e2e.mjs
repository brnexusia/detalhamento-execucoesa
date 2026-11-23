import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true})
const json=(body)=>({status:200,contentType:'application/json',body:JSON.stringify(body)})
const general={id:'catalog-general',slug:'geral',name:'Catálogo Brincos',kind:'geral',minimumOrder:null,isDefault:true,active:true,lockedByPlan:false,explicitMembership:false}
const catalogs=[general,...Array.from({length:21},(_,i)=>({
  ...general,id:'cat-'+(i+1),slug:'cat-'+(i+1),name:'Catálogo '+String(i+1).padStart(2,'0'),
  kind:'varejo',isDefault:false,explicitMembership:true,
}))]
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:850},isMobile:width===390,hasTouch:width===390})
    const page=await context.newPage()
    await page.route('**/api/billing/status',r=>r.fulfill(json({required:false,accessGranted:true})))
    await page.route('**/api/admin/bootstrap?compact=1',r=>r.fulfill(json({
      user:{id:'owner',name:'Teste',email:'owner@example.test'},
      store:{id:'store',name:'Mama',slug:'mama-acessorios',plan_tier:'ouro',accent:'#F25C05',whatsapp:'5571999999999',onboarding_palette_selected:true},
      products:[],productCount:0,activeProductCount:0,productCategories:[],sellers:[],orders:[],stats:{value:0},
    })))
    await page.route('**/api/admin/catalogs',r=>r.fulfill(json({catalogs,canCreateMultiple:true})))
    await page.route('**/api/admin/products/categories**',r=>r.fulfill(json({catalogId:general.id,total:0,categories:[]})))
    await page.route('**/api/admin/products?**',r=>r.fulfill(json({products:[],pagination:{page:1,limit:18,total:0}})))
    await page.goto('http://127.0.0.1:5173/painel/produtos')
    await page.getByText('22 pastas',{exact:true}).waitFor({timeout:20000})
    const folders=page.locator('.svx-catalog-folder')
    assert.equal(await folders.count(),12,'Não carregar 22 cartões de uma vez')
    assert.equal(await page.locator('.svx-catalog-folders.is-compact').count(),1)
    const visualOrdering=await page.evaluate(()=>{
      const details=document.querySelector('.svx-catalog-folder-details')
      const list=document.querySelector('.svx-catalog-folders')
      return Boolean(details&&list&&(details.compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING))
    })
    assert.equal(visualOrdering,true,'Informações da pasta devem estar acima do catálogo de pastas')
    await page.getByRole('button',{name:'Próxima página das pastas'}).click()
    assert.equal(await folders.count(),10,'Segunda página com dez pastas')
    assert.match(await page.locator('.svx-catalog-pagination').innerText(),/Página 2 de 2/)
    await page.getByLabel('Buscar pastas').fill('CATALOGO 21')
    assert.equal(await folders.count(),1,'Busca deve ignorar acentos')
    await page.getByRole('button',{name:'Catálogo 21',exact:true}).click()
    assert.match(await page.locator('.svx-catalog-folder-details h3').innerText(),/CATÁLOGO 21/)
    assert.equal(await page.getByRole('button',{name:'Catálogo 21',exact:true}).getAttribute('aria-pressed'),'true')
    await page.getByLabel('Buscar pastas').fill('sem resultado')
    await page.getByText('Nenhuma pasta encontrada').waitFor()
    await page.getByRole('button',{name:'Limpar busca'}).click()
    assert.equal(await folders.count(),12)
    await page.getByRole('button',{name:'Visualização em cartões'}).click()
    assert.equal(await page.locator('.svx-catalog-folders.is-compact').count(),0)
    await page.getByRole('button',{name:'Visualização compacta'}).click()
    assert.equal(await page.locator('.svx-catalog-folders.is-compact').count(),1)
    const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)
    assert.equal(noOverflow,true,'Sem scroll horizontal em '+width)
    console.log('SHOPVAX_MANY_CATALOGS_UX_PASS',width)
    await context.close()
  }
}finally{await browser.close()}
