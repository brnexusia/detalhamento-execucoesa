import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const store={slug:'look-premium',name:'LOOK PREMIUM',eyebrow:'ATACADO',tagline:'Catálogo comercial',minimumOrder:400,whatsapp:'5571999999999',accent:'#E9B21C',logoUrl:''}
const products=[{id:'one',sku:'SKU-1',name:'Saia midi de malha',description:'Cor e grade disponíveis',price:55,category:'Saias',mediaUrl:'',mediaType:'image',images:[],variations:[]},{id:'two',sku:'SKU-2',name:'Calça pantalona',description:'Nova coleção',price:109.9,category:'Calças',mediaUrl:'',mediaType:'image',images:[],variations:[]}]
const payload={store,seller:{slug:'marina',name:'Marina',phone:store.whatsapp},products,categories:['Saias','Calças'],page:{hasMore:false,nextCursor:null,limit:24}}
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try {
 for(const width of [390,768,1440]) {
  const page=await browser.newPage({viewport:{width,height:844}})
  await page.route('**/api/public/store/**/phase2-config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({customerLoginEnabled:true,theme:{background:'#F3F0E8',textColor:'#161514',font:'system'}})}))
  await page.route('**/api/public/store/**/customers/me',r=>r.fulfill({status:401,body:'{}',contentType:'application/json'}))
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
  await page.goto('http://127.0.0.1:5173/look-premium')
  await page.locator('.store-intro h1').waitFor()
  await page.locator('.app .topbar .shopvax-customer-launcher').waitFor()
  const rects=await page.evaluate(()=>{
    const header=document.querySelector('.topbar')
    const nav=document.querySelector('.store-social-nav')
    const login=document.querySelector('.shopvax-customer-launcher')
    const switcher=document.querySelector('.view-switch')
    const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}
    return {nav:rect(nav),login:rect(login),header:rect(header),navPosition:getComputedStyle(nav).position,loginPosition:getComputedStyle(login).position,switchDisplay:getComputedStyle(switcher).display,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}
  })
  assert.equal(rects.navPosition,'static')
  assert.equal(rects.loginPosition,'static')
  assert.equal(rects.switchDisplay,'flex')
  assert(rects.nav.top>=rects.header.top-2 && rects.nav.bottom<=rects.header.bottom+2,JSON.stringify(rects))
  assert(rects.login.top>=rects.header.top-2 && rects.login.bottom<=rects.header.bottom+2,JSON.stringify(rects))
  assert(rects.scrollWidth<=rects.viewport+2,'Horizontal overflow: '+JSON.stringify(rects))
  await page.screenshot({path:'artifacts/shopvax-redesign/store-navigation-'+width+'.png'})
  await page.getByRole('button',{name:'Feed',exact:true}).last().click()
  await page.locator('.feed-card').first().waitFor()
  const feed=await page.evaluate(()=>{
    const header=document.querySelector('.topbar').getBoundingClientRect()
    const shell=document.querySelector('.feed-shell').getBoundingClientRect()
    return {headerBottom:header.bottom,feedTop:shell.top,feedBottom:shell.bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth}
  })
  assert(Math.abs(feed.headerBottom-feed.feedTop)<3,'Feed starts under header: '+JSON.stringify(feed))
  assert(Math.abs(feed.feedBottom-feed.viewport)<5,'Feed fits viewport: '+JSON.stringify(feed))
  assert(feed.overflow<=2)
  await page.screenshot({path:'artifacts/shopvax-redesign/store-feed-'+width+'.png'})
  await page.getByRole('button',{name:'Perfil',exact:true}).click()
  await page.waitForURL('**/perfil/look-premium')
  await page.close()
 }
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}})
  const post={id:'p1',store:{id:'s1',slug:'look-premium',name:'LOOK PREMIUM',logoUrl:'',accent:'#E9B21C',planTier:'prata'},product:{...products[0],publishedAt:new Date().toISOString()},interactions:{views:9,likes:0,shares:0,followers:0,liked:false,following:false}}
  await page.route('**/api/social/feed?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({posts:[post],page:{hasMore:false,nextCursor:null}})}))
  await page.goto('http://127.0.0.1:5173/feed')
  await page.locator('.social-feed-card').waitFor()
  const layout=await page.evaluate(()=>{
   const card=document.querySelector('.social-feed-card').getBoundingClientRect()
   const media=document.querySelector('.social-feed-media').getBoundingClientRect()
   const copy=document.querySelector('.social-feed-copy').getBoundingClientRect()
   return {card:{left:card.left,right:card.right,width:card.width},media:{left:media.left,right:media.right,width:media.width},copy:{left:copy.left,right:copy.right,width:copy.width},overflow:document.documentElement.scrollWidth-innerWidth}
  })
  if(width===1440){
   assert(layout.card.width>=1000,JSON.stringify(layout))
   assert(layout.media.right<=layout.copy.left+2 && layout.copy.left>=layout.card.left+500,JSON.stringify(layout))
  } else assert(layout.card.width<=width+2)
  assert(layout.overflow<=2,JSON.stringify(layout))
  await page.screenshot({path:'artifacts/shopvax-redesign/social-feed-width-'+width+'.png'})
  await page.close()
 }
} finally {await browser.close()}
console.log('SHOPVAX_LAYOUT_REPAIRS_OK')
