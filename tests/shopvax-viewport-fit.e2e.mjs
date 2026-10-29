import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

/* Cenários de altura real da janela no notebook (e zoom por viewport menor).
 * Não basta testar largura: login e feed devem caber na altura útil. */
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
const post={
 id:'viewport-test-product',
 store:{id:'s1',slug:'look-premium',name:'LOOK PREMIUM',logoUrl:'',accent:'#E9B21C',planTier:'prata'},
 product:{id:'prod1',sku:'A123',name:'CALÇA FLARE ESTAMPADA',description:'Peça de atacado com tamanhos disponíveis. Uma descrição para testar responsividade e leitura no quadro.',price:108.90,category:'Geral',mediaUrl:'',mediaType:'image',images:[],variations:[],publishedAt:new Date().toISOString()},
 interactions:{views:9,likes:1,shares:0,followers:0,liked:false,following:false}
}
try {
 for (const [width,height] of [[1440,900],[1366,768],[1280,640],[1024,600],[1100,576]]) {
   const page=await browser.newPage({viewport:{width,height}})
   await page.addInitScript(()=>{
     window.google={accounts:{id:{
       initialize(){},
       renderButton(node){const button=document.createElement('button');button.textContent='Entrar com Google';node.replaceChildren(button)},
       cancel(){}
     }}}
   })
   await page.route('**/api/public/auth/google-config',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,clientId:'test-client-id'})}))
   await page.goto('http://127.0.0.1:5173/entrar')
   await page.locator('.auth-form .primary-action').waitFor()
   await page.locator('.google-auth-button__mount button').waitFor()
   const m=await page.evaluate(()=>{
     const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
     const poster=document.querySelector('.auth-poster')
     const panel=document.querySelector('.auth-panel')
     const steps=document.querySelector('.auth-poster__steps')
     const form=document.querySelector('.auth-form')
     const submit=document.querySelector('.auth-form>.primary-action')
     const switcher=document.querySelector('.auth-switch')
     return {viewport:innerHeight,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,
       poster:rect(poster),panel:rect(panel),steps:rect(steps),form:rect(form),submit:rect(submit),switcher:rect(switcher),
       posterOverflow:poster.scrollHeight-poster.clientHeight,panelOverflow:panel.scrollHeight-panel.clientHeight}
   })
   assert(m.scrollWidth<=width+2,'Login com rolagem horizontal: '+JSON.stringify({width,height,m}))
   assert(m.scrollHeight<=height+2,'Login com rolagem global vertical: '+JSON.stringify({width,height,m}))
   assert(m.posterOverflow<=2 && m.panelOverflow<=2,'Login não cabe na altura útil: '+JSON.stringify({width,height,m}))
   assert(m.switcher.bottom<=height-3 && m.submit.bottom<=height-3,'CTA de login fora da tela: '+JSON.stringify({width,height,m}))
   assert(m.steps.bottom<=height-3,'Passos do painel esquerdo cortados: '+JSON.stringify({width,height,m}))
   await page.screenshot({path:'artifacts/shopvax-redesign/login-fit-'+width+'x'+height+'.png'})
   console.log('LOGIN_VIEWPORT_FIT',width,height)
   await page.close()
 }
 for(const [width,height] of [[390,844],[768,700],[820,600],[900,640],[1024,600],[1366,768],[1440,900]]) {
   const page=await browser.newPage({viewport:{width,height}})
   await page.route('**/api/social/feed?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({posts:[post],page:{hasMore:false,nextCursor:null}})}))
   await page.goto('http://127.0.0.1:5173/feed')
   await page.locator('.social-feed-card').waitFor()
   const m=await page.evaluate(()=>{
     const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
     const brand=document.querySelector('.social-feed-nav .svx-social-brand')
     const links=document.querySelector('.social-feed-nav__right')
     const card=document.querySelector('.social-feed-card')
     const copy=document.querySelector('.social-feed-copy')
     const actions=document.querySelector('.social-feed-actions')
     return {docWidth:document.documentElement.scrollWidth,
       card:rect(card),media:rect(document.querySelector('.social-feed-media')),copy:rect(copy),
       actions:rect(actions),brand:rect(brand),links:rect(links),nav:rect(document.querySelector('.social-feed-nav')),
       title:rect(document.querySelector('.social-feed-copy h2')),
       cta:rect(document.querySelector('.social-feed-add')),
       copyScroll:copy.scrollHeight-copy.clientHeight}
   })
   assert(m.docWidth<=width+2,'Feed com rolagem horizontal: '+JSON.stringify({width,height,m}))
   assert(m.brand.right<=m.links.left-5,'Logo se sobrepõe aos botões do cabeçalho: '+JSON.stringify({width,height,m}))
   assert(m.card.bottom<=height+3 && m.card.height>=height-3,'Publicação não ocupa janela útil: '+JSON.stringify({width,height,m}))
   assert(m.cta.right<=m.card.right+2 && m.cta.bottom<=height+2,'CTA do produto cortado: '+JSON.stringify({width,height,m}))
   if(width>=800) {
     assert(m.card.width>=Math.min(width-20,1160),'Feed estreito em desktop: '+JSON.stringify({width,height,m}))
     assert(m.media.right<=m.copy.left+3 && m.media.width>m.card.width*.55,'Mídia e dados não estão lado a lado: '+JSON.stringify({width,height,m}))
     assert(m.copy.bottom<=m.actions.top+3,'Interações estão sobre o texto/preço: '+JSON.stringify({width,height,m}))
     assert(m.actions.right<=m.card.right+3,'Interações vazaram para fora do cartão: '+JSON.stringify({width,height,m}))
   } else if(width>700) {
     assert(m.card.width>=width-40,'Feed usa coluna estreita no notebook: '+JSON.stringify({width,height,m}))
   }
   await page.screenshot({path:'artifacts/shopvax-redesign/feed-fit-'+width+'x'+height+'.png'})
   console.log('FEED_VIEWPORT_FIT',width,height)
   await page.close()
 }
} finally {await browser.close()}
console.log('SHOPVAX_VIEWPORT_FIT_OK')
