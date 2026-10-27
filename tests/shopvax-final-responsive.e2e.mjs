import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Homologação transversal das pranchas 03/05/06 e dos módulos 12–14.
// O backend é simulado; este teste NÃO valida disponibilidade de produção.
const browser = await chromium.launch({headless:true})
const products=[
 {id:'p1',sku:'SW-114',name:'Blusa Decote V',description:'Blusa leve com várias cores e tamanhos. '.repeat(6),
  category:'Blusas',price:56.9,mediaType:'image',mediaUrl:'',images:[],featured:true,
  variations:[{name:'Cor',options:['Grena','Preta']},{name:'Tamanho',options:['P','M','G']}]},
 {id:'p2',sku:'SW-115',name:'Calça Pantalona',description:'Peça confortável para pedidos de atacado.',
  category:'Calças',price:109.9,mediaType:'image',mediaUrl:'',images:[],variations:[]},
]
const payload={
 store:{slug:'sw-moda',name:'SW Moda',eyebrow:'Moda Feminina',tagline:'Atacado no WhatsApp',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'},
 seller:{slug:'carla',name:'Carla',phone:'5571999999999'},
 products,categories:['Blusas','Calças'],page:{hasMore:false,nextCursor:null,limit:24},
}
let passed=0
try {
 for(const [width,height] of [[320,568],[390,844],[720,320],[1024,768],[1440,900]]) {
  const context=await browser.newContext({viewport:{width,height}})
  const page=await context.newPage()
  await page.route('**/api/public/store/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',route=>route.fulfill({status:204,body:''}))
  await page.goto('http://127.0.0.1:5173/sw-moda')
  await page.locator('.store-intro h1').waitFor()
  assert.match(await page.locator('.store-intro h1').innerText(),/SW Moda/)
  assert.equal(await page.locator('.product-card__media').count(),2)
  assert.equal(await page.getByRole('button',{name:'Passar uma por uma'}).count(),1)
  await page.locator('.product-card__media').first().click()
  await page.getByRole('button',{name:'Montar grade'}).click()
  await page.getByRole('button',{name:/Grena/}).click()
  await page.getByRole('button',{name:'Aumentar P na cor Grena'}).click()
  await page.locator('.svx-grade__add').click()
  await page.locator('.product-picker').waitFor({state:'detached'})
  assert.equal(await page.locator('.cart-trigger b').innerText(),'1')
  await page.getByRole('button',{name:'Passar uma por uma'}).click()
  await page.locator('.feed-card').first().waitFor()
  const feed=await page.evaluate(()=>{
   const scroller=document.querySelector('.feed-list')
   const cards=[...document.querySelectorAll('.feed-card')]
   const cs=getComputedStyle(scroller)
   return {height:scroller.clientHeight,scrollHeight:scroller.scrollHeight,overflow:cs.overflowY,snap:cs.scrollSnapType,cards:cards.map(e=>e.getBoundingClientRect().height)}
  })
  assert.equal(feed.overflow,'auto')
  assert.match(feed.snap,/y mandatory/)
  assert(feed.cards.length===2 && feed.cards.every(h=>Math.abs(h-feed.height)<3),`Quadros devem ocupar a altura do feed: ${JSON.stringify(feed)}`)
  assert(feed.scrollHeight>=feed.height*1.9,`Segundo produto fora da rolagem: ${JSON.stringify(feed)}`)
  assert.equal(await page.locator('.feed-card__actions button').count(),8)
  await page.emulateMedia({reducedMotion:'reduce'})
  const motion=await page.evaluate(()=>{
   const stamp=document.querySelector('.cart-trigger b')
   const feed=document.querySelector('.feed-list')
   return {ribbon:getComputedStyle(stamp).animationName,feed:getComputedStyle(feed).scrollSnapType}
  })
  assert.equal(motion.ribbon,'none','Movimento reduzido deve desligar animação do contador')
  assert.match(motion.feed,/y proximity/,'Rolagem reduzida mantém navegação livre')
  await page.locator('.cart-trigger').click()
  assert.match(await page.locator('.cart-drawer').innerText(),/Grena/)
  console.log('FINAL_SHOPVAX_VIEWPORT_PASS',width,height)
  passed+=1
  await context.close()
 }
} finally { await browser.close() }
assert.equal(passed,5)
console.log('SHOPVAX_FINAL_RESPONSIVE_AND_MOTION_CHECKS_PASSED',passed)
