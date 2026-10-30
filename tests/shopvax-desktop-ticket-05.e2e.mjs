import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const store={slug:'look-premium',name:'LOOK PREMIUM',eyebrow:'ATACADO',minimumOrder:400,whatsapp:'5571999999999',accent:'#E9B21C',logoUrl:''}
const products=[
 {id:'p1',sku:'LK-001',name:'Calça Pantalona',description:'Produto do atacado',price:250,category:'Calças',mediaUrl:'',mediaType:'image',images:[],variations:[]},
 {id:'p2',sku:'LK-002',name:'Saia Midi',description:'Produto para combinar',price:190,category:'Saias',mediaUrl:'',mediaType:'image',images:[],variations:[]}
]
const payload={store,seller:{slug:'marina',name:'Marina',phone:store.whatsapp},products,categories:['Calças','Saias'],page:{hasMore:false,nextCursor:null,limit:24}}
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try {
 for (const [width,height] of [[390,844],[1024,768],[1280,720],[1440,900]]) {
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
  await page.goto('http://127.0.0.1:5173/look-premium')
  await page.locator('.product-grid .product-card').first().waitFor()
  const ticket=page.locator('.svx-desktop-ticket')
  if(width>=1100) {
   await ticket.waitFor({state:'visible'})
   const first=await page.evaluate(()=>{
    const a=document.querySelector('.svx-desktop-ticket').getBoundingClientRect()
    const b=document.querySelector('.svx-catalog-split__products').getBoundingClientRect()
    return {a:{left:a.left,right:a.right,top:a.top},b:{left:b.left,right:b.right},pageWidth:document.documentElement.scrollWidth}
   })
   assert(first.b.right<=first.a.left+2,'Talão não ocupa coluna separada: '+JSON.stringify(first))
   assert(first.a.right<=width+1 && first.pageWidth<=width+2,'Talão cria rolagem horizontal: '+JSON.stringify(first))
   assert.equal(await ticket.getByText('Seu pedido',{exact:true}).count(),1)
   if(width>=1280){
    const columns=await page.locator('.svx-catalog-split .product-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)
    assert.equal(columns,4,'Prancha 05 requires four product columns beside the ticket')
   }
   assert(await ticket.getByRole('button',{name:/Revisar e mandar/i}).isDisabled(),'Carrinho vazio não pode fechar pedido')
  } else assert(!(await ticket.isVisible()),'Talão desktop aparece no mobile/tablet')
  await page.locator('.product-card__footer button').first().click()
  await page.locator('.picker-add').click()
  if(width>=1100) {
    await ticket.getByText('Calça Pantalona').waitFor()
    assert.equal((await ticket.locator('.svx-desktop-ticket__total strong').innerText()).split('\u00a0').join(' '),'R$ 250,00')
    assert(await ticket.getByRole('button',{name:/Revisar e mandar/i}).isDisabled(),'Não pode enviar antes do mínimo')
  }
  await page.locator('.product-card__footer button').nth(1).click()
  await page.locator('.picker-add').click()
  if(width>=1100) {
    assert.equal((await ticket.locator('.svx-desktop-ticket__total strong').innerText()).split('\u00a0').join(' '),'R$ 440,00')
    assert.equal(await ticket.getByRole('progressbar').getAttribute('aria-valuenow'),'100')
    assert.equal(await ticket.locator('.svx-desktop-ticket__progress-label strong').count(),0,'Do not show R$ 0,00 after minimum reached')
    const review=ticket.getByRole('button',{name:/Revisar e mandar/i})
    assert(await review.isEnabled(),'Talão deve liberar revisão após mínimo')
    await review.click()
    await page.getByRole('dialog',{name:/Confira seu talão/i}).waitFor()
    await page.getByRole('dialog',{name:/Confira seu talão/i}).getByRole('button',{name:'Fechar revisão'}).last().click()
    await page.screenshot({path:'artifacts/shopvax-redesign/desktop-ticket-'+width+'x'+height+'.png',fullPage:false})
    console.log('DESKTOP_TICKET_PASS',width,height)
  } else console.log('MOBILE_TICKET_NOT_SHOWN_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_DESKTOP_TICKET_05_OK')
