import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser=await chromium.launch({headless:true})
const product={
 id:'grade-01',sku:'SW-114',name:'Blusa Decote V Frente e Costas',description:'Peça em viscolycra.',
 category:'Blusas',price:56.90,mediaType:'image',mediaUrl:'',images:[],
 variations:[{name:'Cor',options:['Grena','Preta','Azul Noite']},{name:'Tamanho',options:['P','M','G']}],
 stockEnabled:true,stockQuantity:20,
 variantStock:{'Cor=Grena|Tamanho=P':3,'Cor=Preta|Tamanho=G':0},
}
const payload={
 store:{slug:'sw-moda',name:'SW Moda Feminina',eyebrow:'Atacado',tagline:'Coleção atual',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'},
 seller:{name:'Marina',slug:'marina',phone:'5571999999999'},
 products:[product],categories:['Blusas'],page:{hasMore:false,nextCursor:null,limit:24},
}
let success=0
try{
 for(const [width,height] of [[320,568],[390,844],[1366,768]]){
   const page=await browser.newPage({viewport:{width,height}})
   await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
   await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
   await page.goto('http://127.0.0.1:5173/sw-moda')
   await page.locator('.product-card__media').click()
   assert(await page.locator('.svx-grade').isVisible(),'Color/size product opens with wholesale grade')
   assert.equal(await page.getByRole('button',{name:'Montar grade'}).getAttribute('aria-pressed'),'true','Modo grade deve estar selecionado por padrão')
   await page.getByRole('button',{name:/Grena/}).click()
   await page.getByRole('button',{name:/Preta/}).click()
   await page.getByRole('button',{name:'Aumentar P na cor Grena'}).click()
   await page.getByRole('button',{name:'Aumentar M na cor Grena'}).click()
   await page.getByRole('button',{name:'Aumentar M na cor Grena'}).click()
   assert.equal(await page.getByRole('button',{name:'Aumentar G na cor Preta'}).isDisabled(),true)
   assert.match(await page.locator('.svx-grade__summary').innerText(),/3 PEÇAS/)
   await page.locator('.svx-grade__add').click()
   await page.locator('.product-picker').waitFor({state:'detached'})
   assert.equal((await page.locator('.cart-trigger b').innerText()).trim(),'3')
   await page.locator('.cart-trigger').click()
   assert.equal(await page.locator('.cart-item').count(),2)
   assert.match(await page.locator('.cart-drawer').innerText(),/Grena/)
   assert.match(await page.locator('.cart-total').innerText(),/170,70/)
   console.log('PASS_GRADE',width,height)
   success+=1
   await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_GRADE_CHECKS_PASSED',success)
