import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const data={
  user:{id:'owner-1',name:'Lojista Teste',email:'owner@example.test'},
  store:{id:'store-1',slug:'loja-teste',name:'Loja Teste',accent:'#F25C05',
    plan_tier:'ouro',whatsapp:'5571999999999',is_active:true,onboarding_palette_selected:true},
  products:[],sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},
  productCount:0,activeProductCount:0,productCategories:[],
}
const catalog={id:'catalog-1',slug:'geral',name:'Catálogo principal',kind:'geral',minimumOrder:null,isDefault:true,active:true,lockedByPlan:false,items:[]}
const browser=await chromium.launch({headless:true})
try {
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:860},isMobile:width===390,hasTouch:width===390})
    try{
      await context.route('**/api/billing/status',r=>r.fulfill(json({required:false,accessGranted:true})))
      await context.route('**/api/admin/bootstrap?compact=1',r=>r.fulfill(json(data)))
      await context.route('**/api/admin/catalogs',r=>r.fulfill(json({catalogs:[catalog],canCreateMultiple:true})))
      await context.route('**/api/admin/products/categories**',r=>r.fulfill(json({catalogId:catalog.id,total:0,categories:[]})))
      await context.route('**/api/admin/products?**',r=>r.fulfill(json({products:[],pagination:{page:1,limit:18,total:0}})))
      await context.route('**/api/auth/me',r=>r.fulfill(json({user:data.user,store:data.store})))
      const page=await context.newPage()
      await page.goto('http://127.0.0.1:5173/painel',{waitUntil:'domcontentloaded'})
      await page.locator('.panel-shell').waitFor({timeout:30000})
      await page.locator('.panel-nav').waitFor()
      await page.evaluate(()=>{
        const root=document.querySelector('.panel-shell')
        if(!root)throw Error('Panel shell unavailable')
        root.dataset.keepMounted='yes'
        window.__panelRemounts=0
        const observer=new MutationObserver(()=>{
          if(!document.querySelector('.panel-shell'))window.__panelRemounts++
        })
        observer.observe(document.getElementById('root'),{subtree:true,childList:true})
        window.__navObserver=observer
      })
      for(const [name,path] of [['Produtos','/painel/produtos'],['Pedidos','/painel/pedidos'],['Início','/painel'],['Vendedoras','/painel/vendedoras']]){
        if(width===390){
          // Mobile panel navigation is hidden until the menu is explicitly opened.
          const menu=page.locator('.panel-menu')
          if(await menu.isVisible())await menu.click()
        }
        await page.locator('.panel-nav').getByRole('button',{name:new RegExp(name,'i')}).click()
        await page.waitForURL(url=>url.pathname===path)
        const continuity=await page.evaluate(()=>({
          mounted:document.querySelector('.panel-shell')?.dataset.keepMounted==='yes',
          remounts:window.__panelRemounts||0,
          accessCheck:document.querySelectorAll('.svx-panel-access-check').length
        }))
        assert(continuity.mounted, `${width}px: panel shell remounted at ${path}`)
        assert.equal(continuity.remounts,0,`${width}px: app disappeared during navigation to ${path}`)
        assert.equal(continuity.accessCheck,0,`${width}px: billing loading flashed on ${path}`)
      }
      console.log('SHOPVAX_PANEL_CONTINUITY_PASS',width)
      await page.evaluate(()=>window.__navObserver?.disconnect())
    }finally{await context.close()}
  }
}finally{await browser.close()}
