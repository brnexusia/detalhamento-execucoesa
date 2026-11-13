import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const products=Array.from({length:18},(_,i)=>({
 id:'item-'+i,sku:'REF-COLECAO-INVERNO-COM-CODIGO-LONGO-'+i,
 name:i%2?'Brinco aço inox com nome longo e detalhes especiais de atacado e pronta entrega':
   'Pantalona estampada com vários tamanhos, cores, embalagem e descrição longa que deve caber em sua própria coluna',
 description:'Produto',category:i%2?'Brincos e acessórios para festas':'Calças e pantALONAS',
 price:89.9,media_url:'',media_type:'image',images:[],variant_images:[],pack:'',
 variations:[],featured:i===0,active:true,stock_enabled:false,stock_quantity:0,variant_stock:{}
}))
const data={
 user:{id:'owner-1',name:'Lojista Teste',email:'loja@example.test'},
 store:{id:'store-1',slug:'loja-teste',name:'Loja Teste',eyebrow:'Atacado',tagline:'Coleção',minimum_order:0,
  whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',is_active:true,plan_tier:'ouro',onboarding_palette_selected:true},
 sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},products:[],
 productCount:12013,activeProductCount:12013,
 productCategories:[{category:'Brincos e acessórios para festas',count:6000},{category:'Calças e pantALONAS',count:6013}]
}
const general={id:'catalog-general',slug:'geral',name:'Varejo',kind:'geral',minimumOrder:null,isDefault:true,active:true,lockedByPlan:false,explicitMembership:false,items:[]}
const json=(body)=>({status:200,contentType:'application/json',body:JSON.stringify(body)})
const browser=await chromium.launch({headless:true})
try {
 for(const [width,height] of [[320,720],[390,844],[430,900],[768,900],[1024,800],[1280,900],[1440,900]]){
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/billing/status',r=>r.fulfill(json({required:false,accessGranted:true})))
  await page.route('**/api/admin/bootstrap*',r=>r.fulfill(json(data)))
  await page.route('**/api/admin/catalogs',r=>r.fulfill(json({catalogs:[general],canCreateMultiple:true})))
  await page.route('**/api/admin/products/categories**',r=>r.fulfill(json({
   catalogId:general.id,total:12013,categories:data.productCategories
  })))
  await page.route('**/api/admin/products?*',r=>r.fulfill(json({
   products,pagination:{page:1,limit:18,total:12013}
  })))
  await page.goto('http://127.0.0.1:5173/painel/produtos',{waitUntil:'domcontentloaded'})
  await page.locator('.svx-products .product-admin-card').first().waitFor({timeout:20000})
  const geometry=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
    const table=document.querySelector('.svx-products__table'),head=document.querySelector('.svx-products__headings')
    const rows=[...table.querySelectorAll('.product-admin-card')].slice(0,2)
    const first=rows[0],second=rows[1]
    const name=first.querySelector('.svx-products__name-ref')
    const strong=name.querySelector('.svx-products__name-line strong')
    const ref=name.querySelector('small')
    return {
      width:innerWidth,docWidth:document.documentElement.scrollWidth,table:rect(table),
      shell:rect(document.querySelector('.panel-shell')),
      main:rect(document.querySelector('.panel-main')),
      page:rect(document.querySelector('.panel-page')),
      products:rect(document.querySelector('.svx-products')),
      contentGrid:getComputedStyle(document.querySelector('.panel-shell')).gridTemplateColumns,
      tableComputed:getComputedStyle(table).width,
      row1:rect(first),row2:rect(second),
      headers:getComputedStyle(head).display==='none'?[]:[...head.querySelectorAll('[role=columnheader]')].map(rect),
      cells:[...first.querySelectorAll(':scope > [role=cell]')].map(rect),
      name:rect(name),strong:rect(strong),ref:rect(ref),
      titleOverflow:strong.scrollWidth-strong.clientWidth,refOverflow:ref.scrollWidth-ref.clientWidth
    }
  })
  assert(geometry.docWidth<=width+2,'Página com overflow horizontal: '+JSON.stringify({width,geometry}))
  assert(geometry.row1.left>=geometry.table.left-1 && geometry.row1.right<=geometry.table.right+1,
    'Linha não cabe dentro da tabela: '+JSON.stringify({width,geometry}))
  assert(geometry.row2.top>=geometry.row1.bottom-2,'Linhas sobrepostas: '+JSON.stringify({width,geometry}))
  assert(geometry.titleOverflow<=2 && geometry.refOverflow<=2,'Texto invade outra coluna: '+JSON.stringify({width,geometry}))
  assert(geometry.strong.left>=geometry.name.left-1 && geometry.strong.right<=geometry.name.right+1,
    'Nome não está contido no campo: '+JSON.stringify({width,geometry}))
  const rectOverlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
    Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))
  for(let i=0;i<geometry.cells.length;i++){
    for(let j=i+1;j<geometry.cells.length;j++){
      const area=rectOverlap(geometry.cells[i],geometry.cells[j])
      assert(area<2,'Células de produtos se sobrepõem '+i+'/'+j+': '+JSON.stringify({width,geometry}))
    }
  }
  if(geometry.headers.length){
    assert.equal(geometry.headers.length,geometry.cells.length)
    for(let i=0;i<geometry.headers.length;i++)assert(
      Math.abs(geometry.headers[i].left-geometry.cells[i].left)<=3,
      'Coluna do cabeçalho desalinhada com produto '+i+': '+JSON.stringify({width,geometry}))
  }
  console.log('SHOPVAX_OWNER_PRODUCTS_GEOMETRY_PASS',width,{
    tableWidth:geometry.table.width, pageWidth:geometry.page.width, mainWidth:geometry.main.width, productsWidth:geometry.products.width, grid:geometry.contentGrid, rowHeight:geometry.row1.height,columns:geometry.headers.length})
  await page.close()
 }
}finally{await browser.close()}
