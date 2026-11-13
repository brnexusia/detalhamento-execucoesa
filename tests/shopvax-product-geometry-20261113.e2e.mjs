import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const photo='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><rect width="500" height="700" fill="#ded2c4"/><path d="M100 80H400L350 630H150Z" fill="#934d34"/></svg>')
const products=Array.from({length:5},(_,i)=>({
 id:'p'+i,sku:'SW-'+i,name:i?'Pantalona related '+i:'Pantalona estampada com nome longo que não pode sobrepor opções',
 description:'Calça pantalona com descrição longa, variações de cor e tamanho. '.repeat(3),
 category:'Geral',price:89.9,mediaType:'image',mediaUrl:photo,images:[photo],
 variations:[{name:'Cor',options:['Azul Noite','Preta']},{name:'Tamanho',options:['P','M','G']}],featured:i===0
}))
const payload={store:{slug:'sw-moda',name:'SW Moda',eyebrow:'Moda Feminina',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'},seller:{name:'Atendimento',phone:'5571999999999'},products,categories:['Geral'],page:{hasMore:false}}
const browser=await chromium.launch({headless:true})
try {
 for(const [width,height] of [[320,700],[390,844],[430,900],[860,620],[1024,700],[1440,900],[900,500]]) {
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
  await page.route('**/api/social/stores/sw-moda/products/p0',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({product:products[0]})}))
  // Deep-link directly to modal: no unstable locator click is needed to open it.
  await page.goto('http://127.0.0.1:5173/sw-moda?produto=p0',{waitUntil:'domcontentloaded'})
  await page.locator('.product-picker .svx-grade__head h3').waitFor({timeout:20000})
  const first=await page.evaluate(()=>{
   const r=s=>{const el=document.querySelector(s);if(!el)return null;const a=el.getBoundingClientRect();return {x:a.x,y:a.y,width:a.width,right:a.right,bottom:a.bottom,display:getComputedStyle(el).display}}
   return {
    picker:r('.product-picker'),gallery:r('.product-picker__media'),stage:r('.product-gallery__stage'),
    body:r('.product-picker__body'),scroll:r('.product-picker__scroll'),related:r('.svx-product-page__related'),
    heading:r('.svx-grade__head h3'),head:r('.svx-grade__head'),colors:r('.svx-grade__colors'),
    thumbCount:document.querySelectorAll('.product-gallery__thumbs button').length,
    docWidth:document.documentElement.scrollWidth
   }
  })
  assert(first.picker.width>0 && first.picker.right<=width+2,'Picker exceeds viewport: '+JSON.stringify({width,first}))
  assert(first.body.width>0 && first.scroll.width>0,'Product detail must occupy usable width')
  assert(first.heading.bottom<=first.colors.y+2,'Grade title must not overlap colors: '+JSON.stringify({width,first}))
  assert.equal(first.thumbCount,0,'Single-photo product must not render thumbnail buttons')
  if(width>=860){
   assert(first.stage.width>=first.gallery.width*.78,'Empty thumbnail gutter wastes gallery: '+JSON.stringify({width,first}))
   if(height>520) assert(first.related.y>=first.body.bottom-2,'Related products must not overlap product details: '+JSON.stringify({width,first}))
   else assert.equal(first.related.display,'none')
  } else {
   assert.equal(first.related.display,'none','Related rail should stay hidden on mobile')
  }
  await page.getByRole('button',{name:'Azul Noite'}).click()
  await page.getByRole('button',{name:'Aumentar P na cor Azul Noite'}).click()
  await page.locator('.svx-grade__add').scrollIntoViewIfNeeded()
  const last=await page.evaluate(()=>{
   const r=s=>{const e=document.querySelector(s).getBoundingClientRect();return {top:e.top,bottom:e.bottom,left:e.left,right:e.right,width:e.width}}
   return {
    table:r('.svx-grade__table-scroll'),summary:r('.svx-grade__summary'),add:r('.svx-grade__add'),
    colors:r('.svx-grade__colors'),body:r('.product-picker__body'),scroll:r('.product-picker__scroll')
   }
  })
  assert(last.colors.bottom<=last.table.top+2,'Grade colors overlap table: '+JSON.stringify({width,last}))
  assert(last.table.bottom<=last.summary.top+2,'Grade table overlaps summary: '+JSON.stringify({width,last}))
  assert(last.summary.bottom<=last.add.top+2,'Grade summary overlaps CTA: '+JSON.stringify({width,last}))
  assert(last.add.left>=last.scroll.left-2 && last.add.right<=last.scroll.right+2,'Grade CTA outside column: '+JSON.stringify({width,last}))
  assert(last.add.top>=last.scroll.top-3 && last.add.bottom<=last.scroll.bottom+3,'Grade CTA clipped after scrolling: '+JSON.stringify({width,last}))
  await page.locator('.svx-grade__add').click()
  await page.locator('.product-picker').waitFor({state:'detached'})
  assert.equal(await page.locator('.cart-trigger b').innerText(),'1')
  console.log('SHOPVAX_PICKER_GEOMETRY_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
