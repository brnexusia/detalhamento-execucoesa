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
  'https://img.gopage.bio/p/1-1.jpg','https://img.gopage.bio/p/1-1-sm.jpg',
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
