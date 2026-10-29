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
}finally{await browser.close()}
console.log('SHOPVAX_PANEL_06_LOGIN_OK')
