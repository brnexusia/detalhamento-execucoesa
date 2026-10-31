import assert from 'node:assert/strict'
import { readFileSync,mkdirSync } from 'node:fs'
import {chromium} from 'playwright'

assert.match(readFileSync('src/shopvax-panel-login-06.css','utf8'),/shopvax-panel-mosaic\.webp/)
assert.match(readFileSync('src/Auth.tsx','utf8'),/auth-shell--login/)
assert.match(readFileSync('src/Auth.tsx','utf8'),/Volta pro/)
const image=readFileSync('public/redesign/shopvax-panel-mosaic.webp')
assert(image.length>12000 && image.length<150000,'Official photo mosaic should be optimized for slow networks')
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try{
 for(const [width,height] of [[1440,900],[1366,768],[1100,576],[1024,600],[390,844]]) {
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})}))
  await page.goto('http://127.0.0.1:5173/entrar')
  await page.locator('.auth-form__head h2').waitFor()
  const ribbon = page.locator('.auth-poster__ribbon--black-friday')
  assert.equal(await ribbon.count(),1,'Login precisa da fita Black Friday')
  assert.match(await ribbon.getAttribute('aria-label') || '',/Black Friday/)
  const groups = ribbon.locator('.auth-poster__ribbon-group')
  assert.equal(await groups.count(),2,'Dois ciclos iguais mantêm movimento contínuo')
  const first = await groups.nth(0).innerText()
  assert.equal(await groups.nth(1).innerText(),first,'Ciclos precisam ter texto idêntico')
  assert.match(first,/BLACK FRIDAY/)
  assert.match(first,/WHATSAPP DA VENDEDORA/)
  assert.doesNotMatch(first,/desconto|cupom|R\\$|%\\s*OFF/i,'Fita não deve inventar desconto')
  const tape = await page.evaluate(() => {
    const ribbon = document.querySelector('.auth-poster__ribbon--black-friday')
    const track = ribbon.querySelector('.auth-poster__ribbon-track')
    const groups = ribbon.querySelectorAll('.auth-poster__ribbon-group')
    return {
      animation:getComputedStyle(track).animationName,
      duration:getComputedStyle(track).animationDuration,
      overflow:getComputedStyle(ribbon).overflowX,
      first:groups[0].offsetWidth,
      second:groups[1].offsetWidth,
    }
  })
  assert.equal(tape.animation,'shopvax-login-black-friday-tape')
  assert.equal(tape.duration,'24s')
  assert.equal(tape.overflow,'hidden')
  assert(tape.first>0 && tape.first===tape.second,'Faixa duplicada precisa ter larguras iguais')
  assert.equal(await page.locator('.auth-divider').isVisible(),false,'No isolated OU separator without Google login')
  const d=await page.evaluate(()=>{
   const rect=(q)=>{const el=document.querySelector(q),r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
   return {poster:rect('.auth-poster'),panel:rect('.auth-panel'),headline:rect('.auth-poster__copy h1'),button:rect('.auth-form>.primary-action'),
     text:document.querySelector('.auth-form__head h2').textContent,
     bg:getComputedStyle(document.querySelector('.auth-poster')).backgroundImage,
     docHeight:document.documentElement.scrollHeight,docWidth:document.documentElement.scrollWidth,windowHeight:innerHeight}
  })
  assert.match(d.bg,/shopvax-panel-mosaic\.webp/,'Mosaic from official SVG missing: '+JSON.stringify(d))
  assert.match(d.text,/Acesse seu painel/i)
  assert(d.docWidth<=width+2,'Horizontal overflow '+JSON.stringify(d))
  if(width>=1000){
   assert(d.docHeight<=height+2,'Desktop global vertical overflow '+JSON.stringify(d))
   assert(d.panel.left>=d.headline.right-35,'Form should overlay on right without covering headline '+JSON.stringify(d))
   assert(d.button.bottom<=height+2,'Login CTA must fit without zoom '+JSON.stringify(d))
   assert(d.panel.height<height+2,'Panel must fit viewport '+JSON.stringify(d))
  }
  await page.screenshot({path:'artifacts/shopvax-redesign/panel-06-login-'+width+'x'+height+'.png'})
  await page.close()
 }
 const reduced = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'})
 await reduced.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})}))
 await reduced.goto('http://127.0.0.1:5173/entrar')
 await reduced.locator('.auth-poster__ribbon-track').waitFor()
 const animation = await reduced.locator('.auth-poster__ribbon-track').evaluate(el=>getComputedStyle(el).animationName)
 assert.equal(animation,'none','Respeitar prefers-reduced-motion')
 await reduced.goto('http://127.0.0.1:5173/criar-conta')
 await reduced.locator('.auth-form__head h2').waitFor()
 assert.equal(await reduced.locator('.auth-poster__ribbon--black-friday').count(),0,'Não levar a campanha ao cadastro')
 await reduced.close()
}finally{await browser.close()}
console.log('SHOPVAX_PANEL_06_LOGIN_AND_BLACK_FRIDAY_OK')
