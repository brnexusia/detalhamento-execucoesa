import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Slow 3G / CPU x4 regression: success means the mobile feed remains usable,
// not that it achieved a made-up speed threshold. Real p75 comes from RUM.
const browser=await chromium.launch({headless:true})
const posts=Array.from({length:12},(_,i)=>({
  id:'slow-post-'+i,
  product:{id:'slow-product-'+i,sku:'SLOW-'+i,name:'Produto '+i,
    description:'Teste móvel em rede lenta',price:29.9,category:'Acessórios',
    mediaUrl:'',mediaType:'image',images:[],variations:[],publishedAt:'2026-11-07T00:00:00Z'},
  store:{id:'slow-store',slug:'slow-store',name:'Loja de Teste',
    accent:'#F25C05',logoUrl:'',planTier:'bronze'},
  interactions:{views:0,likes:0,shares:0,followers:0,liked:false,following:false},
}))
try{
  const context=await browser.newContext({
    viewport:{width:390,height:844},
    isMobile:true,hasTouch:true,deviceScaleFactor:2,
  })
  const page=await context.newPage()
  await page.route('**/api/social/feed?**',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({posts,page:{hasMore:false,nextCursor:null}}),
  }))
  await page.route('**/api/social/posts/**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({views:1}),
  }))
  const client=await context.newCDPSession(page)
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions',{
    offline:false,latency:280,
    downloadThroughput:400*1024/8,
    uploadThroughput:400*1024/8,
  })
  await client.send('Emulation.setCPUThrottlingRate',{rate:4})
  const started=Date.now()
  await page.goto('http://127.0.0.1:5173/feed',{waitUntil:'domcontentloaded',timeout:90000})
  await page.locator('.social-feed-card').first().waitFor({timeout:90000})
  const initial=await page.locator('.social-feed-card').count()
  assert(initial>=1 && initial<=6,'Virtualização da lista deve permanecer estável em rede lenta')
  await page.locator('.social-feed-list').evaluate(async(list)=>{
    list.scrollTop=list.clientHeight*3
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  })
  await page.waitForTimeout(350)
  const afterScroll=await page.locator('.social-feed-card').count()
  assert(afterScroll>=1 && afterScroll<=6,'Rolagem móvel não deve renderizar todo o feed')
  const html=await page.locator('body').innerText()
  assert(!/uncaught typeerror|erro fatal|failed to render/i.test(html))
  console.log('SLOW_MOBILE_FEED_OK',JSON.stringify({
    viewport:'390x844',latencyMs:280,throughputKbps:400,cpuSlowdown:4,
    visibleCards:afterScroll,loadElapsedMs:Date.now()-started,
  }))
  await context.close()
}finally{await browser.close()}
