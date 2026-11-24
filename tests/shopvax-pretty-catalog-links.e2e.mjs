import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({headless:true})
const scenarios=[
  {pathname:'/loja-ux',seller:'',catalog:''},
  {pathname:'/loja-ux/ana',seller:'ana',catalog:''},
  {pathname:'/loja-ux/catalogo/colares',seller:'',catalog:'colares'},
  {pathname:'/loja-ux/ana/colares',seller:'ana',catalog:'colares'},
  {pathname:'/loja-ux?catalog=colares',seller:'',catalog:'colares'},
  {pathname:'/loja-ux/ana?catalog=colares',seller:'ana',catalog:'colares'},
]
const product={id:'produto-1',name:'Peça Colares',sku:'COL-1',description:'',price:20,category:'Colares',
  mediaUrl:'',mediaType:'image',images:[],variations:[],featured:false}
const payload={
  store:{slug:'loja-ux',name:'Loja UX',eyebrow:'Atacado',tagline:'',minimumOrder:0,whatsapp:'5511999999999',accent:'#F25C05'},
  seller:{name:'Ana',slug:'ana',phone:'5511999999999'},products:[product],categories:['Colares'],
  page:{hasMore:false,nextCursor:null,limit:24},
  activeCatalog:{id:'cat-1',slug:'colares',name:'Colares',kind:'varejo',isDefault:false,active:true,minimumOrder:null},
  catalogs:[{id:'cat-1',slug:'colares',name:'Colares',kind:'varejo',isDefault:false,active:true,minimumOrder:null}],
}
try {
  for (const scenario of scenarios) {
    const page=await browser.newPage({viewport:{width:390,height:844}})
    const calls=[]
    await page.route('**/api/public/store/**',route=>{
      calls.push(route.request().url())
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)})
    })
    await page.route('**/api/public/events',route=>route.fulfill({status:204,body:''}))
    await page.goto('http://127.0.0.1:5173'+scenario.pathname,{waitUntil:'domcontentloaded'})
    await page.getByText('Peça Colares').first().waitFor({timeout:20000})
    assert.ok(calls.length>0,'Loja não consultou a API: '+scenario.pathname)
    const request=new URL(calls[0])
    assert.equal(request.pathname,'/api/public/store/loja-ux'+(scenario.seller?'/'+scenario.seller:''),scenario.pathname)
    assert.equal(request.searchParams.get('catalog')||'',scenario.catalog,scenario.pathname)
    const filters=page.getByRole('region',{name:'Filtrar produtos por categoria'})
    await filters.getByRole('button',{name:'Todos',exact:true}).waitFor({state:'visible'})
    const categoryButton=filters.getByRole('button',{name:'Colares',exact:true})
    await categoryButton.waitFor({state:'visible'})
    assert.equal(await filters.getByRole('button',{name:'Todos',exact:true}).getAttribute('aria-pressed'),'true')
    const filteredResponse=page.waitForResponse(response=>new URL(response.url()).searchParams.get('category')==='Colares'&&response.url().includes('/api/public/store/'))
    await categoryButton.click()
    await filteredResponse
    assert.equal(await categoryButton.getAttribute('aria-pressed'),'true')
    const filteredRequest=new URL(calls.at(-1))
    assert.equal(filteredRequest.searchParams.get('category'),'Colares')
    assert.equal(filteredRequest.searchParams.get('catalog')||'',scenario.catalog)
    assert.equal(filteredRequest.pathname,request.pathname)
    const allResponse=page.waitForResponse(response=>response.url().includes('/api/public/store/')&&!new URL(response.url()).searchParams.has('category'))
    await filters.getByRole('button',{name:'Todos',exact:true}).click()
    await allResponse
    assert.equal(await filters.getByRole('button',{name:'Todos',exact:true}).getAttribute('aria-pressed'),'true')
    if(scenario.catalog) {
      const link=page.locator('.svx-store-catalog-switch a').first()
      if(await link.count())assert.equal(new URL(await link.getAttribute('href'),'https://shopvax.com.br').pathname,
        scenario.seller?'/loja-ux/ana/colares':'/loja-ux/catalogo/colares')
    }
    await page.close()
  }
  console.log('SHOPVAX_PRETTY_CATALOG_URLS_PASS')
} finally {await browser.close()}
