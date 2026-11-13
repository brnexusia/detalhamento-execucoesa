import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const svg='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="650"><rect width="500" height="650" fill="#d7a77b"/><rect x="80" y="40" width="340" height="570" fill="#8a2d20"/></svg>')
const product={id:'p-1',sku:'SW-01',name:'Pantalona Celeste LUX Fluity',description:'Peça de coleção',category:'Geral',price:89.9,mediaUrl:svg,mediaType:'image',images:[svg],variations:[],featured:true}
const store={slug:'sw-moda',name:'SW Moda Feminina',eyebrow:'Atacado',tagline:'Coleção',minimumOrder:0,whatsapp:'5571999999999',accent:'#F25C05'}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,700],[390,844],[430,900],[1440,900]]){
   const page=await browser.newPage({viewport:{width,height}})
   await page.route('**/api/public/store/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
     store,seller:{name:'Atendimento',phone:store.whatsapp},products:[product],categories:['Geral'],page:{hasMore:false,nextCursor:null,limit:24}
   })}))
   await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
   await page.goto('http://127.0.0.1:5173/sw-moda',{waitUntil:'domcontentloaded'})
   await page.locator('.svx-highlights__media img').waitFor({timeout:20000})
   await page.locator('.catalog-toolbar .search-box input').waitFor()
   assert.equal(await page.locator('.category-strip').count(),0,'Uma categoria não deve repetir Todos/Geral')
   assert.equal(await page.getByRole('button',{name:'Perfil',exact:true}).count(),0,'Catálogo não deve exibir perfil social extra')
   assert.equal(await page.locator('.svx-highlights__media img').count(),1,'Destaques devem ter imagem da peça')
   const metrics=await page.evaluate(()=>{
     const rect=(sel)=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,height:r.height,bottom:r.bottom}}
     const input=document.querySelector('.catalog-toolbar .search-box input')
     const search=document.querySelector('.catalog-toolbar .search-box')
     const image=document.querySelector('.svx-highlights__media img')
     return {
       viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
       inputBorder:getComputedStyle(input).borderTopWidth,
       searchBorder:getComputedStyle(search).borderTopWidth,
       imageLoaded:image.complete && image.naturalWidth>0,
       image:rect('.svx-highlights__media img'),imageBox:rect('.svx-highlights__media'),
       heading:rect('.catalog-heading h2'),panel:rect('.svx-catalog-split__products')
     }
   })
   assert(metrics.imageLoaded,'Foto de destaque não carregou: '+JSON.stringify(metrics))
   assert.equal(metrics.inputBorder,'0px','Linha preta interna da pesquisa voltou: '+JSON.stringify(metrics))
   assert.equal(metrics.searchBorder,'1px','Borda externa da busca deve ser única: '+JSON.stringify(metrics))
   assert(metrics.image.width>=40 && metrics.image.height>=50,'Destaque não tem tamanho útil: '+JSON.stringify(metrics))
   assert(metrics.heading.right<=Math.max(metrics.viewport,metrics.panel.right)+2,'Título invadiu outro conteúdo: '+JSON.stringify(metrics))
   assert(metrics.documentWidth<=metrics.viewport+2,'Overflow horizontal no catálogo: '+JSON.stringify(metrics))
   await page.locator('.catalog-toolbar .search-box input').focus()
   const onFocus=await page.evaluate(()=>({
     innerOutline:getComputedStyle(document.querySelector('.catalog-toolbar .search-box input')).outlineStyle,
     wrapperOutline:getComputedStyle(document.querySelector('.catalog-toolbar .search-box')).outlineStyle
   }))
   assert.equal(onFocus.innerOutline,'none','O input não pode ter contorno preto interno')
   assert.notEqual(onFocus.wrapperOutline,'none','O foco precisa ficar visível no controle externo')
   console.log('SHOPVAX_CATALOG_VISUAL_PASS',width,metrics)
   await page.close()
 }
 // Valida também a pesquisa dentro do painel administrativo, independente de autenticação.
 const page=await browser.newPage({viewport:{width:390,height:800}})
 const css=['src/styles.css','src/saas.css','src/shopvax-product-operations.css','src/shopvax-ui-refinement.css'].map(f=>readFileSync(f,'utf8')).join('\n')
 await page.setContent('<style>'+css+'</style><div class="panel-shell"><div class="svx-products"><label class="svx-products__search"><span>⌕</span><input placeholder="Nome ou referência"></label></div></div>')
 await page.locator('.svx-products__search input').focus()
 const styles=await page.evaluate(()=>{
   const i=document.querySelector('.svx-products__search input'),w=document.querySelector('.svx-products__search')
   return {inputBorder:getComputedStyle(i).borderTopWidth,inputOutline:getComputedStyle(i).outlineStyle,wrapperOutline:getComputedStyle(w).outlineStyle}
 })
 assert.equal(styles.inputBorder,'0px','Busca do painel não pode ter linha interna')
 assert.equal(styles.inputOutline,'none','Busca do painel não pode ter segundo foco')
 assert.notEqual(styles.wrapperOutline,'none','Busca do painel precisa de foco visível')
 console.log('SHOPVAX_PANEL_SEARCH_PASS',styles)
 await page.close()
}finally{await browser.close()}
