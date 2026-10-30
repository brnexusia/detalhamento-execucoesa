import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdirSync} from 'node:fs'

/* Prancha oficial 04: o produto não deve exigir as propriedades
 * de roupas. Tom, tipo, volume ou kit são atributos livres da loja. */
const cases=[
 {slug:'flor-de-sal',name:'FLOR DE SAL',category:'Beleza',accent:'#E9B21C',
  product:{id:'cosmetic',sku:'FL-010',name:'BRUMA MATTE',description:'Produto de beleza',
    price:37.9,category:'Beleza',variations:[
      {name:'Tom',options:['Claro','Médio','Escuro']},
      {name:'Volume',options:['50 ml','100 ml']}]}},
 {slug:'casa-doce',name:'CASA DOCE',category:'Utilidades',accent:'#8A96A1',
  product:{id:'pots',sku:'CD-20',name:'KIT 5 POTES DE VIDRO',description:'Conjunto para casa',
    price:79.9,category:'Utilidades',variations:[
      {name:'Modelo',options:['Redondo','Quadrado']},
      {name:'Quantidade do kit',options:['3 peças','5 peças']}]}},
 {slug:'sw-moda-feminina',name:'SW Moda Feminina',category:'Moda',accent:'#F25C05',
  product:{id:'dress',sku:'SW-01',name:'VESTIDO VERÃO',description:'Grade de atacado',
    price:55,category:'Vestidos',variations:[
      {name:'Cor',options:['Azteca','Carrara']},
      {name:'Tamanho',options:['P','M','G']}]}}
]
const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
try {
 for(const tc of cases){
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:844}})
   const product={...tc.product,mediaType:'image',mediaUrl:'',images:[],stockQuantity:100}
   const payload={store:{slug:tc.slug,name:tc.name,eyebrow:'Atacado',minimumOrder:0,accent:tc.accent,whatsapp:'5571999999999'},
     seller:{name:'Vendedora',phone:'5571999999999'},products:[product],categories:[tc.category],page:{hasMore:false}}
   await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
   await page.goto('http://127.0.0.1:5173/'+tc.slug)
   await page.locator('.product-card__media').first().click()
   await page.locator('.product-picker').waitFor()
   if(tc.slug==='sw-moda-feminina'){
    assert(await page.locator('.svx-grade').isVisible(),'Fashion product starts with grade per SVG 03')
    await page.getByRole('button',{name:'Uma variação'}).click()
   }
   for(const group of tc.product.variations){
    await page.getByRole('button',{name:group.options[0],exact:true}).last().click()
   }
   if(tc.slug!=='sw-moda-feminina'){
    assert.equal(await page.locator('.svx-picker-modes').count(),0,'Generic niches should not show garment grade mode')
   }else{
    assert.equal(await page.locator('.svx-picker-modes').count(),1,'Garments must preserve grade mode')
   }
   await page.locator('.picker-add').click()
   await page.locator('.product-picker').waitFor({state:'detached'})
   assert.equal((await page.locator('.cart-trigger b').innerText()).trim(),'1')
   await page.locator('.topbar .cart-trigger').click()
   const cart=await page.locator('.cart-drawer.is-open').innerText()
   for(const group of tc.product.variations) assert.match(cart,new RegExp(group.name+': '+group.options[0]))
   await page.screenshot({path:'artifacts/shopvax-redesign/niche-04-'+tc.slug+'-'+width+'.png'})
   await page.close()
  }
 }
}finally{await browser.close()}
console.log('SHOPVAX_ALL_NICHES_04_OK')
