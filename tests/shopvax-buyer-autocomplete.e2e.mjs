import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base=process.env.BUYER_UI_BASE||'http://127.0.0.1:5173'
const store={id:'store-real-mock',slug:'loja-avenida',name:'Loja Avenida',logoUrl:'',tagline:'Moda e acessórios',productCount:1}
const product={id:'product-real-mock',sku:'REF-BOLSA-12',name:'Bolsa Modelo Alfa',category:'Bolsas',mediaUrl:'',mediaType:'image',store:{id:store.id,slug:store.slug,name:store.name,logoUrl:store.logoUrl}}
let nonJson=false
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
const page=await context.newPage()
await page.route('**/api/social/discover**',route=>{
 if(nonJson)return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>SPA fallback</title>'})
 const q=new URL(route.request().url()).searchParams.get('q')?.toLocaleLowerCase('pt-BR')||''
 const matchesProduct=!q||[product.name,product.sku,store.name].some(v=>v.toLocaleLowerCase('pt-BR').includes(q))
 const matchesStore=!q||store.name.toLocaleLowerCase('pt-BR').includes(q)
 const data={
  products:matchesProduct?[product]:[],
  stores:matchesStore?[store]:[],
  categories:['Bolsas'],
 }
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
})
try{
 await page.goto(base+'/buscar',{waitUntil:'domcontentloaded'})
 const box=page.getByRole('combobox',{name:'Pesquisar produtos e lojas'})
 await box.waitFor()
 await page.getByRole('region',{name:'Sugestões reais para começar'}).waitFor({timeout:20000})
 assert.equal(await page.locator('.buyer-quick-searches button').count(),2,'Os atalhos devem vir de dados realmente retornados')
 const screen=page.locator('main.buyer-screen')
 const styles=await screen.evaluate(el=>{
   const main=getComputedStyle(el), body=getComputedStyle(document.body), root=getComputedStyle(document.documentElement)
   return {left:parseFloat(main.paddingLeft),right:parseFloat(main.paddingRight),paper:main.backgroundColor,body:body.backgroundColor,html:root.backgroundColor}
 })
 assert.ok(styles.left>=16&&styles.right>=16,'Margem mobile não respeitada: '+JSON.stringify(styles))
 assert.equal(styles.paper,styles.body,'O fundo do body difere do comprador')
 assert.equal(styles.paper,styles.html,'Fundo do html difere do comprador')
 await box.fill('Bol')
 await page.getByRole('listbox',{name:'Sugestões de produtos e lojas'}).waitFor({timeout:15000})
 const option=page.getByRole('option',{name:/Bolsa Modelo Alfa/})
 await option.click()
 assert.equal(await box.inputValue(),'Bolsa Modelo Alfa','Sugestão não preencheu o nome real do produto')
 await page.getByRole('link',{name:/Bolsa Modelo Alfa/}).first().waitFor()
 assert.match(await page.locator('.buyer-search-count').innerText(),/1 produto/)
 await box.fill('Loja')
 await page.getByRole('listbox',{name:'Sugestões de produtos e lojas'}).waitFor({timeout:15000})
 await page.getByRole('option',{name:/Loja Avenida/}).click()
 assert.equal(await box.inputValue(),'Loja Avenida','Sugestão de loja não completou a pesquisa')
 await page.getByRole('link',{name:/Loja Avenida/}).first().waitFor()
 nonJson=true
 await box.fill('invalido')
 await page.getByRole('alert').filter({hasText:'O servidor retornou uma página'}).waitFor({timeout:15000})
 assert.equal(await page.locator('.buyer-search-count').count(),0,'HTML inesperado não pode gerar falsa busca vazia')
 console.log('SHOPVAX_BUYER_AUTOCOMPLETE_MOBILE_PASS',JSON.stringify(styles))
}finally{
 await context.close()
 await browser.close()
}
