import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base=process.env.BUYER_UI_BASE||'http://127.0.0.1:5173'
const product={
 id:'product-ux',sku:'UX-01',name:'Bolsa de Teste UX',description:'Produto de demonstração',
 price:null,category:'Bolsas',mediaUrl:'',mediaType:'image',images:[],variations:[],publishedAt:'2026-11-01T10:00:00Z'
}
const store={id:'store-ux',slug:'loja-ux',name:'Loja UX',logoUrl:'',accent:'#F25C05',planTier:'bronze'}
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
const page=await context.newPage()
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
await page.route('**/api/public/buyer-auth/me',route=>route.fulfill(json({error:'Não autenticado'},401)))
await page.route('**/api/social/feed?**',route=>route.fulfill(json({
 posts:[{id:product.id,product,store,interactions:{views:0,likes:0,shares:0,followers:0,liked:false,following:false}}],
 page:{hasMore:false,nextCursor:null}
})))
await page.route('**/api/social/discover**',route=>{
 const url=new URL(route.request().url())
 const q=url.searchParams.get('q')||''
 if(url.searchParams.has('minPrice'))return route.fulfill(json({code:'BUYER_PROFILE_REQUIRED',error:'Identificação necessária'},401))
 return route.fulfill(json({
 products:q&& !'Bolsa de Teste UX'.toLowerCase().includes(q.toLowerCase())?[]:[{...product,store}],
 stores:q&&!'Loja UX'.toLowerCase().includes(q.toLowerCase())?[]:[{...store,tagline:'Moda',productCount:1}],
 categories:['Bolsas']
 }))
})
await page.route('**/api/social/stores/loja-ux/publications',route=>route.fulfill(json({publications:[product]})))
await page.route('**/api/social/stores/loja-ux',route=>route.fulfill(json({
 store:{...store,tagline:'Moda',eyebrow:'Produtos',productCount:1},
 stats:{followers:0,views:0,following:false}
})))
await page.route('**/api/social/buyer/saved',route=>route.fulfill(json({error:'Não autenticado'},401)))
try{
 await page.goto(base+'/feed',{waitUntil:'domcontentloaded'})
 await page.locator('.social-feed-card').first().waitFor({timeout:30000})
 assert.equal(await page.locator('.buyer-app-nav a').count(),5,'Cinco abas reais na navegação mobile')
 await page.getByRole('link',{name:'Buscar'}).click()
 await page.waitForURL('**/buscar')
 await page.getByRole('searchbox',{name:'Pesquisar produtos e lojas'}).fill('Bolsa')
 await page.getByText('Bolsa de Teste UX').first().waitFor({timeout:30000})
 await page.getByRole('link',{name:/Bolsa de Teste UX/}).first().click()
 await page.waitForURL('**/perfil/loja-ux?produto=product-ux')
 await page.locator('.social-profile-viewer').waitFor({timeout:30000})
 await page.getByRole('button',{name:'Salvar produto'}).click()
 await page.locator('.social-profile-viewer__close').click()
 await page.getByRole('link',{name:'Salvos'}).click()
 await page.waitForURL('**/salvos')
 await page.getByRole('link',{name:'Ver produto'}).waitFor({timeout:30000})
 assert.match(await page.locator('.buyer-screen').innerText(),/Bolsa de Teste UX/)
 await page.getByRole('link',{name:'Carrinhos'}).click()
 await page.waitForURL('**/carrinhos')
 await page.getByRole('heading',{name:'Carrinhos'}).waitFor({timeout:20000})
 assert.match(await page.locator('.buyer-screen').innerText(),/Você ainda não adicionou/)
 await page.getByRole('link',{name:'Perfil'}).click()
 await page.waitForURL('**/comprador')
 await page.getByRole('heading',{name:'Meu perfil'}).waitFor({timeout:20000})
 await page.getByRole('link',{name:'Feed'}).click()
 await page.waitForURL('**/feed')
 console.log('SHOPVAX_BUYER_MOBILE_NAVIGATION_PASS')
}finally{
 await context.close()
 await browser.close()
}
