import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const css = readFileSync('src/shopvax-final-motion.css','utf8')
const design = readFileSync('src/ShopvaxDesignSystem.tsx','utf8')
const store = readFileSync('src/PublicStoreV2.tsx','utf8')
const order = readFileSync('src/ShopvaxOrderReady.tsx','utf8')
const grade = readFileSync('src/ShopvaxGrade.tsx','utf8')
for(const [pattern,label] of [
  [/40\)\)/,'ribbon speed 40px/s'],
  [/svx-ribbon-scroll/,'seamless ribbon'],
  [/animation-play-state:paused/,'pause on hover'],
  [/svx-stamp-hit 220ms/,'stamp 220ms'],
  [/svx-number-up 160ms/,'count 160ms'],
  [/transition:transform 80ms/,'press 80ms'],
  [/grid-template-columns:repeat\(20/,'minimum segments'],
  [/transition:background-color 30ms/,'minimum segment 30ms'],
  [/svx-ticket-tear 420ms/,'ticket tear'],
  [/prefers-reduced-motion:reduce/,'reduced motion'],
  [/120ms ease-out/,'reduced motion 120ms']
]) assert.match(css+design, pattern, 'Motion contract missing: '+label)
assert.match(store,/SVTicker className="store-intro__ribbon"/)
assert.match(store,/svx-minimum-segments/)
assert.match(store,/key=\{cartCount\}>NA GRADE/)
assert.match(grade,/svx-motion-count/)
assert.match(order,/onClick=\{\(\)=>setOpening\(true\)\}/)
assert.doesNotMatch(order,/>ENVIADO</)
const browser = await chromium.launch({headless:true})
try {
 for (const reduce of ['no-preference','reduce']) {
   const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:reduce})
   await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
     store:{slug:'look-premium',name:'LOOK PREMIUM',minimumOrder:400,accent:'#F25C05',whatsapp:'5571999999999'},
     seller:{slug:'marina',name:'Marina',phone:'5571999999999'},
     products:[{id:'p1',name:'Saia midi',sku:'REF-100',description:'Peça de verão',price:55,category:'Saias',mediaType:'image',mediaUrl:'',images:[],variations:[]}],
     categories:['Saias'],page:{hasMore:false}
   })}))
   await page.goto('http://127.0.0.1:5173/look-premium')
   const ticker=page.locator('.svx-motion-ticker__track')
   await ticker.waitFor()
   const state=await ticker.evaluate(el=>({duration:getComputedStyle(el).animationDuration,name:getComputedStyle(el).animationName,width:el.firstElementChild?.getBoundingClientRect().width}))
   assert(state.width>0,'ticker unit must be measurable')
   if(reduce==='reduce') assert.equal(state.name,'none')
   else assert.equal(state.name,'svx-ribbon-scroll')
   await page.locator('.topbar .cart-trigger').click()
   const segments=await page.locator('.svx-minimum-segments i').count()
   assert.equal(segments,20)
   await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_MOTION_08_OK')
