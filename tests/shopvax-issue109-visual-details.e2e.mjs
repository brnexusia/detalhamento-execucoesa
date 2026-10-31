import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const mark = readFileSync('src/ShopvaxBrandMotion.tsx','utf8')
const styles = readFileSync('src/shopvax-brand-motion.css','utf8')
for (const name of ['assemble','mirror','water']) assert.match(mark,new RegExp(name))
assert.match(mark,/shopvax-symbol\.svg/,'A marca final precisa usar o SVG oficial')
assert.match(mark,/M370 300H430\.893/,'O V deve manter o path vetorial oficial')
assert.match(mark,/M370 581\.286H430\.893/,'O A deve manter o path vetorial oficial')
assert.match(styles,/svx-mark-v-descend/)
assert.match(styles,/svx-mark-a-ascend/)
assert.match(styles,/svx-mark-assembled-spin/)
assert.match(styles,/prefers-reduced-motion:reduce/)
const plans = ['bronze','prata','ouro'].map((code,index)=>({
  code,name:code[0].toUpperCase()+code.slice(1),
  monthlyPrice:[49.90,94.90,144.90][index],
  sellerLimit:[5,15,null][index],catalogLimit:[1,3,null][index],
  photoLimit:[5,10,null][index],franchiseeLimit:[0,2,null][index],productLimit:[500,2000,null][index],
}))
const browser = await chromium.launch({headless:true})
try {
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}})
    await page.route('**/api/public/plans',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans})}))
    await page.goto('http://127.0.0.1:5173/para-lojas')
    await page.getByRole('heading',{name:'Escolha o tamanho da sua empresa ou loja'}).waitFor()
    assert.equal(await page.locator('.svx-plans__stamp').innerText(),'SEU PRÓXIMO PASSO')
    assert.equal(await page.getByRole('heading',{name:'O que muda é a sua operação!'}).count(),1)
    const rect=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,screen:innerWidth}))
    assert(rect.doc<=rect.screen+2,'A nova tipografia não pode criar overflow: '+JSON.stringify({width,rect}))
    await page.close()
  }
  for(const reduce of ['no-preference','reduce']){
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:reduce})
    await page.route('**/api/public/auth/google-config',route=>route.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
    await page.route('**/api/auth/login',route=>route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}))
    await page.goto('http://127.0.0.1:5173/entrar')
    await page.locator('.auth-form input[type="email"]').fill('teste@example.test')
    await page.locator('.auth-form input[type="password"]').fill('senha-local-de-teste')
    assert.equal(await page.locator('.auth-poster .wordmark > img').count(),2,
      'O login precisa do símbolo oficial e do wordmark, sem composição improvisada')
    await page.locator('.auth-form>.primary-action').click()
    if(reduce==='no-preference') {
      const mark=page.locator('.svx-auth-loading-overlay .svx-brand-motion.is-animating')
      await mark.waitFor()
      const state=await mark.evaluate(el=>({
        assembly:getComputedStyle(el.querySelector('.svx-brand-motion__assembly')).animationName,
        exit:getComputedStyle(el.querySelector('.svx-brand-motion__symbol')).animationName,
        background:getComputedStyle(el.closest('.svx-auth-loading-overlay')).backgroundColor,
        lower:getComputedStyle(el.querySelector('.svx-brand-motion__a')).fill,
        upper:getComputedStyle(el.querySelector('.svx-brand-motion__v')).fill,
      }))
      assert.equal(state.assembly,'svx-mark-assembled-spin')
      assert.equal(state.exit,'svx-mark-exit')
      assert.equal(state.background,'rgb(22, 21, 20)')
      assert.equal(state.lower,'rgb(243, 240, 232)')
      assert.equal(state.upper,'rgb(242, 92, 5)')
      assert.equal(new URL(page.url()).pathname,'/entrar','O login só deve navegar após o ciclo')
    }
    await page.waitForURL('**/painel',{timeout:7000})
    await page.close()
  }
} finally { await browser.close() }
console.log('SHOPVAX_109_VISUAL_DETAILS_OK')
