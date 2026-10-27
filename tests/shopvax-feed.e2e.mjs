import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser=await chromium.launch({headless:true})
const payload={
 store:{slug:'sw-moda',name:'SW Moda',eyebrow:'Atacado',tagline:'Coleção atual',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'},
 seller:{name:'Marina',slug:'marina',phone:'5571999999999'},
 products:[{id:'p01',sku:'114',name:'Blusa Decote V',description:'Esta peça veste bem e tem várias cores para compor os pedidos de moda no atacado. '+('Disponível na coleção atual. '.repeat(5)),category:'Blusas',price:56.90,mediaUrl:'',mediaType:'image',images:[],variations:[]}],
 categories:['Blusas'],page:{hasMore:false,nextCursor:null,limit:24},
}
let passed=0
try{
 for(const [width,height] of [[320,568],[390,844],[1366,768]]){
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
  await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
  await page.goto('http://127.0.0.1:5173/sw-moda')
  await page.locator('.store-intro h1').waitFor()
  await page.locator('.view-switch').getByRole('button',{name:'Feed'}).click()
  await page.locator('.feed-card').waitFor()
  assert.equal(await page.locator('.svx-feed-caption button').innerText(),'Mais')
  await page.locator('.svx-feed-caption button').click()
  assert.equal(await page.locator('.svx-feed-caption button').getAttribute('aria-expanded'),'true')
  await page.getByRole('button',{name:'Salvar Blusa Decote V'}).click()
  assert.equal(await page.getByRole('button',{name:'Remover Blusa Decote V dos salvos'}).getAttribute('aria-pressed'),'true')
  await page.reload()
  await page.locator('.view-switch').getByRole('button',{name:'Feed'}).click()
  assert.equal(await page.getByRole('button',{name:'Remover Blusa Decote V dos salvos'}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'Compartilhar Blusa Decote V'}).click()
  await page.getByRole('button',{name:'Remover Blusa Decote V dos salvos'}).click()
  assert.equal(await page.getByRole('button',{name:'Salvar Blusa Decote V'}).getAttribute('aria-pressed'),'false')
  console.log('PASS_FEED',width,height)
  passed++
  await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_FEED_CHECKS_PASSED',passed)
