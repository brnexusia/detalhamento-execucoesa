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
assert.match(mark,/className="svx-brand-motion__rotor"/,'O rotor deve ser HTML, fora das coordenadas SVG')
assert.match(css,/\.svx-brand-motion__rotor\{display:block;width:100%;height:100%;position:relative;transform-origin:50% 50%/,
 'O X deve girar no centro da sua caixa HTML, não do grupo SVG')
assert.doesNotMatch(css,/\.svx-brand-motion\.is-animating \.svx-brand-motion__assembly\s*\{\s*animation:/,
 'É proibido rotacionar o grupo SVG para não criar órbita')
assert.doesNotMatch(css,/transform-origin:480px 440\.643px/,
 'Coordenadas absolutas aqui causam giro orbital')
assert.match(css,/630ms cubic-bezier[^;]*520ms both/,'Giro só inicia após o encaixe das peças')
assert.match(css,/svx-mark-exit 300ms cubic-bezier[^;]*1150ms both/,'Expandir e esmaecer o X nos 300ms finais')
assert.match(css,/62%\{opacity:1;transform:scale\(1\.82\)\}/,'O X deve crescer antes do fade')
assert.match(css,/100%\{opacity:0;transform:scale\(2\.28\)\}/,'Expansão final deve superar 2x')
assert.match(css,/background:var\(--svx-paper,#F3F0E8\)/,'Loading regular deve manter fundo bege')
assert.match(css,/\.svx-auth-loading-overlay \.svx-branded-loading\{min-height:100dvh;background:#161514/,'Somente o login usa loading escuro')
const loading=readFileSync('src/ShopvaxLoading.tsx','utf8')
assert.match(loading,/setTimeout\(\(\) => setShowMotion\(true\), 200\)/,'Não animar carregamentos abaixo de 200ms')
assert.match(loading,/1_500/,'Ciclo repetido dura no máximo 1,5s')
const auth=readFileSync('src/Auth.tsx','utf8')
assert.match(auth,/finishAuthenticatedEntry/,'Vinheta deve acontecer após login confirmado')
assert.match(auth,/1_450/,'Vinheta não pode exceder 1,5s')
const bridge=readFileSync('src/ShopvaxLoginTransition.tsx','utf8')
assert.match(bridge,/MutationObserver/,'Transição deve aguardar destino montado')
assert.match(bridge,/\.panel-shell/,'Transição não pode terminar durante fallback do painel')
assert.doesNotMatch(auth,/showLoginMotion && <div/,'Cobertura não pode desmontar junto com Auth')
assert.match(panel,/60_000/,'Repetir a cada 1 minuto')
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
 await page.clock.fastForward('01:00')
 await page.locator('.svx-panel-mark .svx-brand-motion.is-animating').waitFor()
 const animation=await page.locator('.svx-panel-mark .svx-brand-motion__rotor')
   .evaluate(el=>getComputedStyle(el).animationName)
 assert.equal(animation,'svx-mark-assembled-spin')
 await page.clock.fastForward('00:04')
 assert.equal(await page.locator('.svx-panel-mark .svx-brand-motion.is-animating').count(),0)

 // Em login instantâneo, o carregamento usual não é exibido, mas a vinheta de sucesso é.
 const login=await context.newPage()
 await login.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
 await login.route('**/api/auth/login',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}))
 // Backend lento DEPOIS do login. A vinheta não deve expor fallback bege.
 await login.route('**/api/admin/bootstrap*',async r=>{
   await new Promise(resolve=>setTimeout(resolve,1600))
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)})
 })
 await login.goto('http://127.0.0.1:5173/entrar')
 await login.locator('.auth-form input[type=email]').fill('ana@example.test')
 await login.locator('.auth-form input[type=password]').fill('senha-de-teste-123')
 await login.locator('.auth-form>.primary-action').click()
 const overlay=login.locator('.svx-auth-loading-overlay')
 await overlay.waitFor()
 assert.equal(new URL(login.url()).pathname,'/entrar','A transição precisa finalizar antes de navegar')
 assert.equal(await overlay.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(22, 21, 20)')
 assert.equal(await overlay.locator('.svx-brand-motion__symbol').evaluate(el=>getComputedStyle(el).animationName),'svx-mark-exit')
 // Medição geométrica, não apenas presença de rotate(360deg) no CSS.
 // Em seis ângulos diferentes, o centro físico do X precisa ficar no mesmo pixel.
 const rotation=await overlay.locator('.svx-brand-motion__rotor').evaluate(el=>{
   const svg=el.querySelector('svg')
   const keyframes=el.getAnimations().find(a=>a.animationName==='svx-mark-assembled-spin')
   if(!svg || !keyframes) throw Error('Rotor não contém SVG com animação de 360 graus')
   keyframes.pause()
   return [520,650,780,910,1040,1150].map(ms=>{
     keyframes.currentTime=ms
     const position=new DOMPoint(480,440.643).matrixTransform(svg.getScreenCTM())
     const matrix=new DOMMatrix(getComputedStyle(el).transform)
     return {ms,x:position.x,y:position.y,angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI}
   })
 })
 const start=rotation[0]
 const drift=Math.max(...rotation.map(p=>Math.hypot(p.x-start.x,p.y-start.y)))
 assert(drift<1,'O X está orbitando! Centro deslocou '+drift.toFixed(2)+'px: '+JSON.stringify(rotation))
 assert(rotation.slice(1,-1).some(p=>Math.abs(p.angle)>30),
   'A animação deve rodar no próprio eixo, não permanecer estática')
 // Quando o URL já é /painel, a tela preta AINDA deve estar por cima do fallback.
 await login.waitForURL('**/painel',{timeout:7000})
 assert.equal(await overlay.isVisible(),true,'O preto deve cobrir o bootstrap até o painel real estar pronto')
 const stillDark=await overlay.evaluate(el=>({
   bg:getComputedStyle(el).backgroundColor,
   opacity:Number(getComputedStyle(el).opacity),
 }))
 assert.equal(stillDark.bg,'rgb(22, 21, 20)')
 assert(stillDark.opacity>=0.99,'Não revelar fundo bege antes do painel: '+JSON.stringify(stillDark))
 await login.locator('.panel-shell').waitFor({timeout:7000})
 await overlay.waitFor({state:'detached',timeout:7000})
 assert.equal(await overlay.count(),0)
 await login.close()

 // Credenciais inválidas não podem disparar uma celebração de login.
 const bad=await context.newPage()
 await bad.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
 await bad.route('**/api/auth/login',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"Credenciais inválidas."}'}))
 await bad.goto('http://127.0.0.1:5173/entrar')
 await bad.locator('.auth-form input[type=email]').fill('ana@example.test')
 await bad.locator('.auth-form input[type=password]').fill('senha-incorreta')
 await bad.locator('.auth-form>.primary-action').click()
 await bad.locator('.form-error').waitFor()
 assert.equal(await bad.locator('.svx-auth-loading-overlay').count(),0)
 await bad.close()
 await context.close()

 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 await reduced.route('**/api/admin/bootstrap*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}))
 const reducedPage=await reduced.newPage()
 await reducedPage.clock.install()
 await reducedPage.goto('http://127.0.0.1:5173/painel')
 await reducedPage.locator('.svx-panel-mark .svx-brand-motion').waitFor()
 await reducedPage.clock.fastForward('01:00')
 assert.equal(await reducedPage.locator('.svx-panel-mark .svx-brand-motion.is-animating').count(),0,
   'Movimento reduzido não deve executar ciclo')
 await reduced.close()
} finally { await browser.close() }
console.log('SHOPVAX_BRANDED_LOADING_CONTEXT_HELP_OK')
