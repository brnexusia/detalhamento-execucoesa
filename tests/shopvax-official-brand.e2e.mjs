import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const svgFiles=['public/brand/shopvax-symbol.svg','public/brand/shopvax-symbol-dark.svg','public/brand/shopvax-wordmark.svg','public/brand/shopvax-wordmark-light.svg','public/brand/shopvax-lockup.svg','public/favicon.svg']
for (const path of svgFiles) {
 const svg=readFileSync(path,'utf8')
 assert.match(svg,/<svg[^>]+viewBox=/i,path)
 assert.match(svg,/<path[^>]+d="/i,path)
 assert.doesNotMatch(svg,/<script|onload=|<foreignObject|href="http/i,'SVG inseguro: '+path)
}
const symbol=readFileSync(svgFiles[0],'utf8')
const wordmark=readFileSync(svgFiles[2],'utf8')
const favicon=readFileSync('public/favicon.svg','utf8')
assert.match(symbol,/M370 300H430.893L480 403.321/,'Símbolo oficial V+A ausente')
assert.match(wordmark,/M644.056 721.413H662.308L677.028 752.383/,'X vetorizado do wordmark ausente')
assert.match(favicon,/#F25C05/)
assert.match(favicon,/#F3F0E8/)
const home=readFileSync('src/Home.tsx','utf8')
const auth=readFileSync('src/Auth.tsx','utf8')
const panel=readFileSync('src/AdminApp.tsx','utf8')
const social=readFileSync('src/SocialFeed.tsx','utf8')
const profile=readFileSync('src/SocialStoreProfile.tsx','utf8')
for (const [file,source] of [['Home',home],['Auth',auth],['AdminApp',panel],['SocialFeed',social],['SocialStoreProfile',profile]]) {
 assert.match(source,/\/brand\/shopvax-wordmark/,'Wordmark não utilizado: '+file)
 assert.doesNotMatch(source,/<span[^>]*>(?:SV|SHOPVAX)<\/span>/i,'Marca textual provisória: '+file)
}
assert.match(readFileSync('src/main.tsx','utf8'),/shopvax-brand-assets.css/)
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
const browser=await chromium.launch({headless:true})
try {
 for(const [width,height] of [[390,844],[1440,900]]) {
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/plans',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:[]})}))
  await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})}))
  await page.route('**/api/social/feed?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({posts:[],page:{hasMore:false,nextCursor:null}})}))
  for(const [path,selector] of [
    ['/para-lojas','.home-nav .svx-brand-wordmark'],
    ['/entrar','.auth-poster .svx-brand-wordmark'],
    ['/feed','.social-feed-nav .svx-brand-wordmark'],
  ]) {
    await page.goto('http://127.0.0.1:5173'+path)
    await page.locator(selector).waitFor()
    const state=await page.locator(selector).evaluate(el=>({
      loaded:el instanceof HTMLImageElement && el.complete && el.naturalWidth>0,
      w:el.getBoundingClientRect().width,
      h:el.getBoundingClientRect().height,
      overflow:document.documentElement.scrollWidth-innerWidth,
      src:el instanceof HTMLImageElement ? el.getAttribute('src') : '',
    }))
    assert(state.loaded && state.w>30 && state.h>=15,'Wordmark indisponível: '+JSON.stringify({path,state}))
    assert(state.overflow<=2,'Rolagem horizontal: '+JSON.stringify({path,state}))
    await page.screenshot({path:'artifacts/shopvax-redesign/official-brand-'+path.slice(1)+'-'+width+'.png'})
  }
  const svg=await page.request.get('http://127.0.0.1:5173/favicon.svg')
  assert.equal(svg.status(),200)
  assert.match(await svg.text(),/M1132 331\.771H1158\.57L1180 376\.857/)
  console.log('SHOPVAX_OFFICIAL_BRAND_PASS',width)
  await page.close()
 }
} finally { await browser.close() }
