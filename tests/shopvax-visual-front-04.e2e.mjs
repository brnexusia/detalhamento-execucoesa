import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const logo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#203040"/><text x="12" y="53" font-size="44" fill="white">L</text></svg>')
const store = { slug:'loja-teste', name:'LOJA ATELIÊ DO ATACADO', eyebrow:'MODA NO ATACADO', tagline:'Peças para montar sua grade', minimumOrder:400, whatsapp:'', accent:'#E9B21C', logoUrl:logo }
const products = [
 {id:'p1',sku:'REF-ATACADO-2026-LOJA',name:'Calça em tecido para o dia a dia',description:'Produto de demonstração da regressão visual',price:55,category:'Calças',mediaUrl:'',mediaType:'image',images:[],variations:[]},
 {id:'p2',sku:'REF-2',name:'Blusa de malha',description:'Teste de nicho',price:29.90,category:'Blusas',mediaUrl:'',mediaType:'image',images:[],variations:[]}
]
const payload = { store, seller:{slug:'marina',name:'Marina',phone:'5571999999999'}, products, categories:['Calças','Blusas'], page:{hasMore:false,nextCursor:null,limit:24} }
const browser = await chromium.launch({ headless:true })
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try {
  for (const [width,height] of [[320,568],[390,844],[430,932],[768,1024],[1024,768],[1440,900]]) {
    const context = await browser.newContext({ viewport:{width,height}, reducedMotion:'reduce' })
    const page = await context.newPage()
    await page.route('**/api/public/store/**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
    await page.route('**/api/public/events', route => route.fulfill({status:204,body:''}))
    await page.goto('http://127.0.0.1:5173/loja-teste')
    await page.locator('.store-intro.svx-vitrine h1').waitFor()
    const result = await page.evaluate(() => {
      const logo = document.querySelector('.store-intro__logo')
      const headerLogo = document.querySelector('.brand__logo')
      const name = document.querySelector('.store-intro__identity h1')
      const reference = document.querySelector('.product-card__meta')
      const catalog = document.querySelector('.svx-discovery__rail small')
      const style = el => getComputedStyle(el)
      return {
        logos: [logo,headerLogo].map(el => el ? ({border:style(el).borderTopWidth,background:style(el).backgroundColor}) : null),
        nameFont: Number.parseFloat(style(name).fontSize),
        referenceFont: reference ? Number.parseFloat(style(reference).fontSize) : null,
        catalogFont: catalog ? Number.parseFloat(style(catalog).fontSize) : null,
        scrollWidth:document.documentElement.scrollWidth,
        viewport:innerWidth,
        storeName:name.textContent
      }
    })
    assert.equal(result.storeName,store.name,'A marca da loja deve ser protagonista')
    assert(result.logos.every(x => x?.border === '0px'),'A logo não pode ter quadro: '+JSON.stringify(result))
    assert(result.nameFont>=42,'Nome ilegível no mobile: '+JSON.stringify(result))
    assert(result.referenceFont>=12,'Referência do catálogo deve ser legível: '+JSON.stringify(result))
    assert(result.catalogFont>=12,'Referência da coleção deve ser legível: '+JSON.stringify(result))
    assert(result.scrollWidth<=result.viewport+2,'Overflow horizontal: '+JSON.stringify(result))
    await page.screenshot({ path:`artifacts/shopvax-redesign/frente04-vitrine-${width}.png`,fullPage:true })
    await context.close()
  }
} finally { await browser.close() }
console.log('SHOPVAX_FRONT04_C02_C03_RESPONSIVE_OK')
