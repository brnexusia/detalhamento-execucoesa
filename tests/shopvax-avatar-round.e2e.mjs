import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const css = [
  'src/shopvax-brand.css',
  'src/social-profile.css',
  'src/shopvax-social-official.css',
  'src/shopvax-ui-refinement.css',
].map(path => readFileSync(path, 'utf8')).join('\n')
const browser = await chromium.launch({ headless:true })
try {
  for(const width of [320,390,430,1280]){
    const page = await browser.newPage({viewport:{width,height:850}})
    try{
      await page.setContent(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>*{box-sizing:border-box}body{margin:0}${css}</style>
      <div class="app"><header class="topbar"><img class="brand__logo" alt="Logo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='orange'/%3E%3C/svg%3E"><span class="brand__mark">L</span></header>
      <section class="store-intro"><img class="store-intro__logo" alt="Logo loja" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='orange'/%3E%3C/svg%3E"></section></div>
      <div class="social-feed-page"><div class="social-feed-store__avatar"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='orange'/%3E%3C/svg%3E"></div></div>
      <div class="social-profile-page"><div class="social-profile-avatar"><img alt="Logo social" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='orange'/%3E%3C/svg%3E"></div></div>`)
      const avatars=await page.locator('.brand__logo,.brand__mark,.store-intro__logo,.social-feed-store__avatar,.social-profile-avatar').evaluateAll(elements=>elements.map(el=>{
        const r=el.getBoundingClientRect(), s=getComputedStyle(el)
        return {className:el.className,width:r.width,height:r.height,borderRadius:s.borderTopLeftRadius,overflow:s.overflow}
      }))
      for(const v of avatars){
        assert.equal(v.borderRadius,'50%',`${width}px: avatar não circular: ${JSON.stringify(v)}`)
        assert.equal(v.overflow,'hidden',`${width}px: sem recorte de imagem: ${JSON.stringify(v)}`)
        assert(Math.abs(v.width-v.height)<1,`${width}px: avatar não quadrado: ${JSON.stringify(v)}`)
      }
      console.log('SHOPVAX_AVATAR_ROUND_PASS',width,avatars)
    }finally{await page.close()}
  }
}finally{await browser.close()}
