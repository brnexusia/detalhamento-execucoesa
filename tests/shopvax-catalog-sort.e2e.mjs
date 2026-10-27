import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const items=[
 {id:'p-1',sku:'P1',name:'Peça Alta',description:'Atacado',category:'Blusas',price:120,mediaUrl:'',mediaType:'image',images:[],variations:[],featured:false},
 {id:'p-2',sku:'P2',name:'Peça Baixa',description:'Atacado',category:'Blusas',price:30,mediaUrl:'',mediaType:'image',images:[],variations:[],featured:false},
 {id:'p-3',sku:'P3',name:'Peça Média',description:'Atacado',category:'Calças',price:70,mediaUrl:'',mediaType:'image',images:[],variations:[],featured:false}
]
const store={slug:'sw-moda',name:'SW Moda',eyebrow:'Atacado',tagline:'Coleção',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,568],[390,844],[1366,768]]){
  const page=await browser.newPage({viewport:{width,height}})
  let requestSort=''
  await page.route('**/api/public/store/**',route=>{
    const url=new URL(route.request().url()),sort=url.searchParams.get('sort')||'newest',q=url.searchParams.get('q')||'',category=url.searchParams.get('category')||''
    requestSort=sort
    const filtered=items.filter(p=>(!q||p.name.toLowerCase().includes(q.toLowerCase()))&&(!category||p.category===category))
    filtered.sort((a,b)=>sort==='price_asc'?a.price-b.price:sort==='price_desc'?b.price-a.price:0)
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({store,seller:{name:'Atendimento',phone:store.whatsapp},products:filtered,categories:['Blusas','Calças'],page:{hasMore:false,nextCursor:null,limit:24}})})
  })
  await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
  await page.goto('http://127.0.0.1:5173/sw-moda')
  await page.locator('.product-card').first().waitFor()
  await page.getByLabel('Ordenação dos produtos').selectOption('price_asc')
  await page.waitForFunction(()=>document.querySelector('.product-card h3')?.textContent?.includes('Peça Baixa'))
  assert.equal(requestSort,'price_asc')
  const names=await page.locator('.product-card h3').allInnerTexts()
  assert.deepEqual(names,['Peça Baixa','Peça Média','Peça Alta'])
  await page.getByLabel('Ordenação dos produtos').selectOption('price_desc')
  await page.waitForFunction(()=>document.querySelector('.product-card h3')?.textContent?.includes('Peça Alta'))
  assert.equal(requestSort,'price_desc')
  await page.locator('.search-box input').fill('sem resultado')
  await page.locator('.svx-catalog-empty').waitFor()
  await page.getByRole('button',{name:'Limpar filtros'}).click()
  await page.locator('.product-card').first().waitFor()
  assert.equal(await page.getByLabel('Ordenação dos produtos').inputValue(),'newest')
  console.log('CATALOG_SORT_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
console.log('CATALOG_SORT_TESTS_PASSED',3)
