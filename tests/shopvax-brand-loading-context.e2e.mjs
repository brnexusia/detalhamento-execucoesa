import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const mark = readFileSync('src/ShopvaxBrandMotion.tsx','utf8')
const css = readFileSync('src/shopvax-brand-motion.css','utf8')
const panel = readFileSync('src/ShopvaxPanelMark.tsx','utf8')
const app = readFileSync('src/App.tsx','utf8')
assert.match(mark,/M370 300H430\.893L480 403\.321/,'Usar o vetor V oficial')
assert.match(mark,/M370 581\.286H430\.893L480 477\.964/,'Usar o vetor A oficial')
assert.match(css,/svx-mark-v-descend/)
assert.match(css,/svx-mark-a-ascend/)
assert.match(css,/svx-mark-assembled-spin/)
assert.match(css,/rotate\(360deg\)/)
assert.match(css,/1150ms cubic-bezier[^;]*1150ms both/,'Giro começa após chegada das peças')
assert.match(panel,/180_000/,'Repetir somente a cada 3 minutos')
assert.match(panel,/visibilityState !== 'visible'/,'Não animar a aba oculta')
assert.match(app,/helpAllowed/)

const fixture = {
  user:{id:'u1',email:'ana@example.test',name:'Ana Santos'},
  store:{id:'s1',slug:'teste',name:'Atacado Teste',eyebrow:'Moda',tagline:'',
    minimum_order:0,whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',
    is_active:true,plan_tier:'bronze',onboarding_palette_selected:true},
  products:[],sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},
}
const browser=await chromium.launch({headless:true})
try {
 for (const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.route('**/api/public/auth/google-config',route=>route.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
  await context.route('**/api/admin/bootstrap*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}))
  const page=await context.newPage()
  await page.goto('http://127.0.0.1:5173/entrar')
  await page.locator('.auth-form__head h2').waitFor()
  assert.equal(await page.getByRole('button',{name:'Precisa de ajuda?'}).count(),1)
  assert.equal(await page.locator('.auth-poster .wordmark > img').count(),2)
  const logos=await page.locator('.auth-poster .wordmark > img').evaluateAll(images=>images.map(el=>({
    loaded:el.complete && el.naturalWidth>0, src:el.getAttribute('src'),
    width:el.getBoundingClientRect().width
  })))
  assert(logos.every(el=>el.loaded && el.width>0),JSON.stringify(logos))
  await page.goto('http://127.0.0.1:5173/para-lojas')
  await page.locator('.home-shell').waitFor()
  assert.equal(await page.getByRole('button',{name:'Precisa de ajuda?'}).count(),0,'Não mostrar ajuda global na home')
  await page.goto('http://127.0.0.1:5173/painel')
  await page.locator('.panel-brand .svx-panel-mark').waitFor()
  assert.equal(await page.getByRole('button',{name:'Precisa de ajuda?'}).count(),1)
  await page.goto('http://127.0.0.1:5173/painel/produtos')
  await page.locator('.panel-brand .svx-panel-mark').waitFor()
  assert.equal(await page.getByRole('button',{name:'Precisa de ajuda?'}).count(),0,'Ajuda não deve cobrir produtos')
  assert((await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=2)
  await context.close()
 }

 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference'})
 await context.route('**/api/admin/bootstrap*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}))
 const page=await context.newPage()
 await page.clock.install()
 await page.goto('http://127.0.0.1:5173/painel')
 const icon=page.locator('.svx-panel-mark .svx-brand-motion')
 await icon.waitFor()
 assert.equal(await icon.getAttribute('class'), 'svx-brand-motion svx-brand-motion--dark')
 await page.clock.fastForward('03:00')
 await page.locator('.svx-panel-mark .svx-brand-motion.is-animating').waitFor()
 const animation=await page.locator('.svx-panel-mark .svx-brand-motion__assembly')
   .evaluate(el=>getComputedStyle(el).animationName)
 assert.equal(animation,'svx-mark-assembled-spin')
 await page.clock.fastForward('00:04')
 assert.equal(await page.locator('.svx-panel-mark .svx-brand-motion.is-animating').count(),0)
 await context.close()

 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 await reduced.route('**/api/admin/bootstrap*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}))
 const reducedPage=await reduced.newPage()
 await reducedPage.clock.install()
 await reducedPage.goto('http://127.0.0.1:5173/painel')
 await reducedPage.locator('.svx-panel-mark .svx-brand-motion').waitFor()
 await reducedPage.clock.fastForward('03:00')
 assert.equal(await reducedPage.locator('.svx-panel-mark .svx-brand-motion.is-animating').count(),0,
   'Movimento reduzido não deve executar ciclo')
 await reduced.close()
} finally { await browser.close() }
console.log('SHOPVAX_BRANDED_LOADING_CONTEXT_HELP_OK')
