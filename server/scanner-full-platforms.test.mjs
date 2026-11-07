import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCatalog, detectPlatform } from './scanner-collector.mjs'
import { parseGopageInertia, gopageProducts, gopagePagination, gopageCategoryUrls } from './scanner-gopage.mjs'

const origin='https://catalog-fixture.catalogo.com.br'
const markup=props=>'<html><div id="app" data-page=\''+JSON.stringify({component:'Catalog/Index',props}).replace(/&/g,'&amp;').replace(/'/g,'&#39;')+'\'></div></html>'
const product=(id,additional={})=>({
 id,name:'Produto '+id,slug:'produto-'+id,sku:'REF-'+id,
 description:'Descrição integral '+id,price:'19.90',
 images:[{url:'https://img.gopage.bio/p/'+id+'-1.jpg',thumb:'https://img.gopage.bio/p/'+id+'-1-sm.jpg'},
         {url:'https://img.gopage.bio/p/'+id+'-2.jpg'}],
 categories:[{name:'Vestidos'}],active:true,available_to_purchase:true,
 ...additional,
})
const page=(items,current,total,more=true,extra={})=>({
 page:{prices_unlocked:true},categories:[],
 productsList:{products:items,pagination:{current_page:current,total_pages:Math.ceil(total/2),total,per_page:2,has_more_pages:more}},
 ...extra,
})
function mock(mapping) {
 const requested=[]
 return {
  requested,
  request:async(input,options={})=>{
   const uri=String(input);requested.push({uri,method:options.method||'GET'})
   const val=mapping[uri]
   if(!val)return {ok:false,status:404,url:uri,contentType:'text/html',body:''}
   return {ok:true,status:200,url:uri,contentType:'text/html; charset=utf-8',body:val}
  },
 }
}
test('GoPage Inertia gives complete product gallery, category, SKU and attributes, without banner images',()=>{
 const obj=page([product(1,{variations:[{id:11,sku:'P-11',size:'M',color:'Azul',price:24.9,
  images:[{url:'https://img.gopage.bio/p/variant.jpg'}]}],price_tiers:[{min_quantity:10,unit_price:'18,50'}]})],1,1,false)
 const props=parseGopageInertia(markup(obj))
 const result=gopageProducts(props,origin)
 assert.equal(result.length,1)
 assert.equal(result[0].external_id,'1')
 assert.equal(result[0].category,'Vestidos')
 assert.equal(result[0].sku,'REF-1')
 assert.deepEqual(result[0].images,[
  'https://img.gopage.bio/p/1-1.jpg',
  'https://img.gopage.bio/p/1-2.jpg','https://img.gopage.bio/p/variant.jpg',
 ])
 assert.equal(result[0].variants.length,1)
 assert.equal(result[0].variants[0].size,'M')
 assert.equal(result[0].variants[0].color,'Azul')
 assert.match(result[0].description,/10\+ un. R\$ 18,50/)
 assert.equal(result[0].price,19.9)
})
test('GoPage respects protected pricing even when backend embeds numeric values in public page data',()=>{
 const result=gopageProducts(page([product(3,{price:85.9,price_hidden:true})],1,1,false),origin)
 assert.equal(result[0].price,null)
 const guest=gopageProducts({...page([product(4)],1,1,false),page:{prices_unlocked:false}},origin)
 assert.equal(guest[0].price,null)
 assert.equal(guest[0].variants.length,0)
 assert.doesNotMatch(guest[0].description,/R\$/)
})
test('GoPage category discovery only accepts same-host category URL and nested children',()=>{
 const props=page([],1,0,false,{categories:[
  {url:origin+'/categoria/vestidos',children:[{url:origin+'/categoria/midi'}]},
  {url:'https://evil.invalid/categoria/steal'},
 ]})
 assert.deepEqual(gopageCategoryUrls(props,origin),[
  origin+'/categoria/vestidos',origin+'/categoria/midi',
 ])
})
test('GoPage complete public catalog paginates beyond featured 16 (3 pages simulated), without category duplicates',async()=>{
 const first=page([product(1),product(2)],1,6,true,{categories:[{url:origin+'/categoria/vestidos'}]})
 const second=page([product(3),product(4)],2,6,true)
 const third=page([product(5),product(6)],3,6,false)
 const network=mock({
  [origin+'/']:markup(first),
  [origin+'/?page=2']:markup(second),
  [origin+'/?page=3']:markup(third),
 })
 const got=await collectCatalog(origin+'/',{request:network.request,strictPlatformAdapters:true,maxProducts:100})
 assert.equal(got.platform,'gopage')
 assert.equal(got.candidateCount,6)
 assert.equal(got.expectedProducts,6)
 assert.equal(got.complete,true)
 assert.equal(got.candidates.filter(p=>p.images.length>=2).length,6)
 assert.deepEqual(network.requested.map(x=>x.uri),[
   origin+'/',origin+'/?page=2',origin+'/?page=3',
 ])
})
test('GoPage stops with explicit failure when page 2 repeats page 1 rather than calling import complete',async()=>{
 const first=page([product(1),product(2)],1,4,true)
 const network=mock({[origin+'/']:markup(first),[origin+'/?page=2']:markup(first)})
 await assert.rejects(
  collectCatalog(origin+'/',{request:network.request,strictPlatformAdapters:true}),
  /repetiu|página 1/i
 )
})
test('GoPage with explicitly selected category respects its own total',async()=>{
 const link=origin+'/categoria/vestidos'
 const x=page([product(10),product(11)],1,3,true)
 const y=page([product(12)],2,3,false)
 const network=mock({[link]:markup(x),[link+'?page=2']:markup(y)})
 const got=await collectCatalog(link,{request:network.request,strictPlatformAdapters:true})
 assert.equal(got.candidateCount,3)
 assert.equal(got.candidates.length,3)
})
test('Vesti loads every advertised page, even after the first group of products',async()=>{
 const source='https://v.vesti.mobi/l2m/catalogo/3d65968050c8488'
 const endpoint='https://apivesti.vesti.mobi/appmarca/v2/catalogue/3d65968050c8488/company/l2m/'
 const u1=new URL(endpoint);u1.searchParams.set('page','1')
 for(const [k,v] of Object.entries({perpage:'60',with_categories:'true',with_colors:'true',with_product_colors:'true',with_sizes:'true',with_brands:'true',with_prices:'true',with_tags:'1'}))u1.searchParams.set(k,v)
 // Exact query order in collector is irrelevant; the mock routes using page.
 const seen=[]
 const request=async(input)=>{
  const u=new URL(input);seen.push(u.toString())
  if(u.hostname==='v.vesti.mobi')return {ok:true,status:200,url:u.toString(),contentType:'text/html',body:'<html><img src="https://cdn-op.vesti.mobi/a.jpg"></html>'}
  if(u.hostname==='apivesti.vesti.mobi'){
   const n=Number(u.searchParams.get('page'))
   return {ok:true,status:200,url:u.toString(),contentType:'application/json',body:JSON.stringify({
    products:n===1?[{id:'A',name:'Camisa A',price:15,media:[{url:'https://cdn.vesti.mobi/a.webp'}]}]:
      n===2?[{id:'B',name:'Camisa B',price:25,media:[{url:'https://cdn.vesti.mobi/b.webp'}]}]:[],
    links:{next:n===1?'https://apivesti.vesti.mobi/next?page=2':null},meta:{current_page:n},
   })}
  }
  return {ok:false,status:404,url:u.toString(),contentType:'text/html',body:''}
 }
 const got=await collectCatalog(source,{request,strictPlatformAdapters:true})
 assert.equal(got.platform,'vesti')
 assert.equal(got.candidateCount,2)
 assert.deepEqual(got.candidates.map(x=>x.title),['Camisa A','Camisa B'])
 assert.ok(seen.some(x=>x.includes('page=2')))
})


test('FácilZap walks every POST page until explicit sem_mais_produtos without duplicating variants',async()=>{
 const base='https://facilzap.app.br/testshop'
 const route=base+'/carregar_produtos/{PAGE}/{CATEGORY}/123'
 const html='<html><script>window.FZCatalogoRuntime.listagem = '+
  JSON.stringify({urlCarregarProdutosTemplate:route,categoria:0,searchId:''})+';</script></html>'
 const requests=[]
 const request=async(input,options={})=>{
  const u=String(input);requests.push({u,method:options.method||'GET'})
  if(u===base)return {ok:true,status:200,url:u,contentType:'text/html',body:html}
  const page=Number(/carregar_produtos\/(\d+)\//.exec(u)?.[1])
  if(page){
   const payload=page===3?{acao:'sem_mais_produtos'}:
    {produtos:[{id:page,nome:'Peça '+page,preco:'49,90',
      imagens:['produtos/'+page+'.webp'],
      variacoes:{['v'+page]:{id:'v'+page,nome:'Azul M',preco:'49,90'}}}]}
   return {ok:true,status:200,url:u,contentType:'application/json',body:JSON.stringify(payload)}
  }
  return {ok:false,status:404,url:u,contentType:'text/plain',body:''}
 }
 const result=await collectCatalog(base,{request,strictPlatformAdapters:true})
 assert.equal(result.platform,'facilzap')
 assert.equal(result.candidateCount,2)
 assert.equal(result.complete,true)
 assert.deepEqual(result.candidates.map(x=>x.external_id),['1','2'])
 assert.ok(result.candidates.every(x=>x.images.length>0))
 assert.ok(result.candidates.every(x=>x.variants.length===1))
 assert.equal(requests.filter(x=>x.method==='POST').length,3)
})

test('FácilZap treats repeated first page as incomplete, not successful import',async()=>{
 const base='https://facilzap.app.br/again'
 const route=base+'/carregar_produtos/{PAGE}/{CATEGORY}/123'
 const html='<html><script>window.FZCatalogoRuntime.listagem = '+
  JSON.stringify({urlCarregarProdutosTemplate:route,categoria:0})+';</script></html>'
 const request=async(input,options={})=>{
  const u=String(input)
  if(u===base)return {ok:true,status:200,url:u,contentType:'text/html',body:html}
  if(u.includes('/carregar_produtos/'))return {ok:true,status:200,url:u,contentType:'application/json',
    body:JSON.stringify({produtos:[{id:1,nome:'Peça repetida',preco:'10,00'}]})}
  return {ok:false,status:404,url:u,contentType:'text/plain',body:''}
 }
 await assert.rejects(collectCatalog(base,{request,strictPlatformAdapters:true}),/repetiu a página/i)
})

test('bounded scan transparently reports a partial catalog instead of reporting total completion',async()=>{
 const first=page([product(1),product(2)],1,6,true)
 const second=page([product(3),product(4)],2,6,true)
 const network=mock({[origin+'/']:markup(first),[origin+'/?page=2']:markup(second)})
 const res=await collectCatalog(origin+'/',{request:network.request,maxPages:1,strictPlatformAdapters:true})
 assert.equal(res.candidateCount,2)
 assert.equal(res.expectedProducts,6)
 assert.equal(res.complete,false)
})

test('FácilZap does not import images from unrelated product details',async()=>{
 const base='https://facilzap.app.br/minhaloja'
 const tpl=base+'/carregar_produtos/{PAGE}/{CATEGORY}/123'
 const html='<script>window.FZCatalogoRuntime.listagem = '+
  JSON.stringify({urlCarregarProdutosTemplate:tpl,categoria:0})+';</script>'
 const unrelated='<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'Product',name:'Outro Produto',sku:'OUTRO',
  image:['https://example.com/errado.webp'],
 })+'</script>'
 const request=async(input,options={})=>{
  const u=String(input)
  if(u===base)return {ok:true,status:200,url:u,contentType:'text/html',body:html}
  if(u.endsWith('/produto/1'))return {ok:true,status:200,url:u,contentType:'text/html',body:unrelated}
  if(u.includes('/carregar_produtos/')){
   const page=Number(/carregar_produtos\/(\d+)\//.exec(u)?.[1])
   return {ok:true,status:200,url:u,contentType:'application/json',body:JSON.stringify(
    page===1?{produtos:[{id:1,nome:'Brinco A',sku:'A1',imagens:['produtos/correto.webp']}]}:{acao:'sem_mais_produtos'})}
  }
  return {ok:false,status:404,url:u,contentType:'text/plain',body:''}
 }
 const result=await collectCatalog(base,{request,strictPlatformAdapters:true})
 assert.equal(result.candidateCount,1)
 assert.deepEqual(result.candidates[0].images,['https://arquivos.facilzap.app.br/produtos/correto.webp'])
})
