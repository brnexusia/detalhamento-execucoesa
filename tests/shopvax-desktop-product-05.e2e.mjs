import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const photo='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><rect width="500" height="700" fill="#E7E3DA"/><rect x="120" y="80" width="260" height="540" fill="#F25C05"/></svg>')
const products=Array.from({length:5},(_,i)=>({id:'p'+i,sku:'REF-'+i,name:'CALÇA PANTALONA '+i,description:'Modelo com quatro cores e três tamanhos para o atacado.',price:109.9,category:'Calças',mediaType:'image',mediaUrl:photo,images:[photo,photo+'#'+i],variations:[{name:'Cor',options:['Azteca','Carrara']},{name:'Tamanho',options:['P','M','G']}]}))
const payload={store:{slug:'look-premium',name:'LOOK PREMIUM',eyebrow:'Atacado',minimumOrder:400,whatsapp:'5571999999999',accent:'#F25C05'},seller:{slug:'marina',name:'Marina',phone:'5571999999999'},products,categories:['Calças'],page:{hasMore:false}}
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try{
 for(const width of [390,860,1024,1440]){
  const height=width===860?620:width===1024?700:900
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.goto('http://127.0.0.1:5173/look-premium')
  await page.locator('.product-grid button.product-card__media').first().click()
  await page.locator('.product-picker').waitFor()
  assert(await page.locator('.svx-grade').isVisible(),'Grade default missing in layered product')
  await page.getByRole('button',{name:'Uma variação'}).click()
  const layout=await page.evaluate(()=>{
   const $=s=>document.querySelector(s)
   const rect=s=>{const el=$(s);const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(el).display}}
   return {picker:rect('.product-picker'),nav:rect('.svx-product-page__nav'),media:rect('.product-gallery__stage'),body:rect('.product-picker__body'),related:rect('.svx-product-page__related'),footer:rect('.product-picker__footer'),overflow:document.documentElement.scrollWidth-innerWidth}
  })
  assert(layout.overflow<=2,'horizontal overflow '+JSON.stringify({width,layout}))
  if(width>=860){
   assert(layout.nav.display!=='none','desktop product requires full-page header')
   assert(layout.related.display!=='none','desktop product requires related rail')
   assert(layout.picker.width>=width-2,'desktop product should not be centered modal: '+JSON.stringify(layout))
   assert(layout.media.right<=layout.body.x+3,'gallery and product text should be in separate columns: '+JSON.stringify(layout))
   assert(layout.related.y>=layout.media.y,'related products should follow product')
   assert(layout.footer.bottom<=height+2,'add to cart must remain visible: '+JSON.stringify(layout))
  } else {
   assert.equal(layout.nav.display,'none')
   assert.equal(layout.related.display,'none')
  }
  await page.screenshot({path:'artifacts/shopvax-redesign/product-page-'+width+'.png'})
  await page.getByRole('button',{name:'Fechar',exact:true}).click()
  await page.locator('.product-picker').waitFor({state:'detached'})
  await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_DESKTOP_PRODUCT_05_OK')
