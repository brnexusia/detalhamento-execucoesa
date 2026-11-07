import { load } from 'cheerio'
import { safeRequest,detectPlatform } from '../server/scanner-collector.mjs'
import { extractFacilZapRuntime,parseVestiContext } from '../server/scanner-platforms.mjs'
const targets=[
 {label:'facilzap1',url:'https://facilzap.app.br/damafinnalingerie'},
 {label:'facilzap2',url:'https://facilzap.com.br/centralbrasatacado'},
 {label:'gopage',url:'https://meuestoque.catalogo.com.br/'},
 {label:'gopage_category',url:'https://meuestoque.catalogo.com.br/categoria/celulares-mRwey'},
 {label:'vesti',url:'https://v.vesti.mobi/l2m/catalogo/3d65968050c8488'},
 {label:'vesti_without_id',url:'https://v.vesti.mobi/leslymodas/catalogo'},
]
for (const entry of targets){
 try {
  const r=await safeRequest(entry.url,{timeout:18000})
  const $=load(r.body)
  const links=$('a[href]').map((_,a)=>$(a).attr('href')).get()
  const tags=[...r.body.matchAll(/.{0,70}(?:catalogo|produtos|pageSize|pagination|totalPages|page_count|carregar_produtos|FZCatalogoRuntime|nextPage|apiUrl|catalogId|gopage|vesti).{0,130}/gi)].slice(0,30).map(x=>x[0].replace(/\s+/g,' ').slice(0,210))
  const scripts=$('script[src]').map((_,a)=>$(a).attr('src')).get().slice(0,25)
  console.info('PLATFORM_DIAG',JSON.stringify({
    label:entry.label,url:r.url,status:r.status,length:r.body.length,platform:detectPlatform(r.body,r.url),
    contentType:r.contentType,
    runtime:extractFacilZapRuntime(r.body),vesti:parseVestiContext(r.url,r.body),
    paginationLinks:links.filter(s=>/page|pagina|categoria|produto|catalog|colecao|carregar|p=\d/i.test(s)).slice(0,32),
    scripts,patterns:tags,
  }))
 } catch(e){console.info('PLATFORM_DIAG',JSON.stringify({label:entry.label,error:String(e?.message||e).slice(0,300)}))}
}


function outline(value,prefix='',depth=0,rows=[]) {
 if(depth>5||rows.length>=80 || value==null)return rows
 if(Array.isArray(value)) {
  if(value.length)rows.push({path:prefix,length:value.length,sampleKeys:Object.keys(value[0]&&typeof value[0]==='object'?value[0]:{}).slice(0,22)})
  if(value.length && typeof value[0]==='object')outline(value[0],prefix+'[0]',depth+1,rows)
  return rows
 }
 if(typeof value!=='object')return rows
 for(const [key,entry] of Object.entries(value)){
  if(/product|categor|item|page|pagination|catalog|meta|collection|data|links|groups/i.test(key)) {
    rows.push({path:prefix+'.'+key,type:Array.isArray(entry)?'array':typeof entry,
      length:Array.isArray(entry)?entry.length:undefined,
      keys:entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.keys(entry).slice(0,18):undefined})
  }
  if(entry&&typeof entry==='object'&&rows.length<80)outline(entry,prefix+'.'+key,depth+1,rows)
 }
 return rows
}
for(const url of [
 'https://meuestoque.catalogo.com.br/',
 'https://meuestoque.catalogo.com.br/categoria/celulares-mRwey',
 'https://meuestoque.catalogo.com.br/produto/ac-relogio-haylou-vibe-ls30-preto',
]){
 try{
  const r=await safeRequest(url,{timeout:20000})
  const $=load(r.body)
  const node=$('[data-page]').first()
  let obj=null
  try{obj=JSON.parse(node.attr('data-page')||'null')}catch{}
  console.log('INERTIA_DIAG',JSON.stringify({url,status:r.status,found:Boolean(obj),
    length:node.attr('data-page')?.length,propsKeys:Object.keys(obj?.props||{}),
    paths:outline(obj?.props||{}).slice(0,70)}))
 } catch(e){console.log('INERTIA_DIAG',JSON.stringify({url,error:String(e.message)}))}
}
for(const page of [1,2]){
 const url='https://apivesti.vesti.mobi/appmarca/v2/catalogue/3d65968050c8488/company/l2m/?page='+page+'&perpage=60&with_categories=true&with_colors=true&with_product_colors=true&with_sizes=true&with_brands=true&with_prices=true&with_tags=1'
 try{
  const r=await safeRequest(url,{accept:'application/json',timeout:15000})
  const obj=JSON.parse(r.body)
  console.log('VESTI_API_DIAG',JSON.stringify({page,status:r.status,length:r.body.length,keys:Object.keys(obj),
   products:Array.isArray(obj.products)?obj.products.length:null,
   links:obj.links,meta:obj.meta,
   sampleFields:Array.isArray(obj.products)?Object.keys(obj.products[0]||{}).slice(0,40):[],
  }))
 }catch(e){console.log('VESTI_API_DIAG',JSON.stringify({page,error:String(e.message).slice(0,300)}))}
}
for(const u of ['https://facilzap.app.br/damafinnalingerie','https://facilzap.com.br/centralbrasatacado']){
 const r=await safeRequest(u,{timeout:15000})
 console.log('FACILZAP_BODY',JSON.stringify({url:u,len:r.body.length,prefix:r.body.slice(0,250),ending:r.body.slice(-300)}))
}

for(const u of ['https://meuestoque.catalogo.com.br/','https://meuestoque.catalogo.com.br/categoria/celulares-mRwey','https://meuestoque.catalogo.com.br/produto/ac-relogio-haylou-vibe-ls30-preto']){
 try{
  const r=await safeRequest(u,{timeout:15000})
  const $=load(r.body); const obj=JSON.parse($('[data-page]').first().attr('data-page')||'{}'); const p=obj.props||{}
  const products=p.productsList
  const product=p.product
  const entry=products?.data?.[0]||products?.products?.[0]||products?.[0]||product
  const categories=p.categories?.data||p.categories
  console.log('GOPAGE_PROPS',JSON.stringify({url:u,
   productListType:typeof products,listKeys:Object.keys(products||{}).slice(0,30),
   listCount:products?.data?.length||products?.products?.length||products?.length,
   pagination:{current_page:products?.current_page,last_page:products?.last_page,
    next_page_url:products?.next_page_url,total:products?.total,per_page:products?.per_page,
    links:products?.links?.slice?.(-3)},
   entryFields:Object.keys(entry||{}).slice(0,70),
   entryImageFields:Object.fromEntries(Object.entries(entry||{}).filter(([k])=>/image|gallery|photo|media|variation|price|category|stock|slug|sku|reference/i.test(k)).map(([k,v])=>[k,Array.isArray(v)?{length:v.length,sampleKeys:Object.keys(v[0]||{}).slice(0,30)}:v&&typeof v==='object'?Object.keys(v).slice(0,35):String(v).slice(0,120)])),
   categoriesType:typeof categories,categoriesCount:categories?.length||0,
   categoriesFields:Object.keys(categories?.[0]||{}).slice(0,30),
  }))
 }catch(e){console.log('GOPAGE_PROPS',JSON.stringify({url:u,error:String(e.message).slice(0,300)}))}
}

for(const u of ['https://meuestoque.catalogo.com.br/','https://meuestoque.catalogo.com.br/?page=2','https://meuestoque.catalogo.com.br/categoria/celulares-mRwey?page=2','https://damafinnalingerie.com.br/']){
 try{
  const r=await safeRequest(u,{timeout:18000})
  const $=load(r.body)
  const page=JSON.parse($('[data-page]').first().attr('data-page')||'{}')
  const props=page.props||{}
  const list=props.productsList||{}
  console.log('PAGINATION_DIAG',JSON.stringify({url:u,status:r.status,bytes:r.body.length,
    platform:detectPlatform(r.body,u),
    pagination:list.pagination,
    listCount:Array.isArray(list.products)?list.products.length:0,
    firstIds:list.products?.slice(0,3).map(x=>x.id),
    route:props.route,
    runtime:extractFacilZapRuntime(r.body),
    tinyPrefix:r.body.length<150?r.body:'',
  }).slice(0,3000))
 }catch(e){console.log('PAGINATION_DIAG',JSON.stringify({url:u,error:String(e?.message||e).slice(0,220)}))}
}

const sampleListUrl='https://apivesti.vesti.mobi/appmarca/v2/catalogue/3d65968050c8488/company/l2m/?page=1&perpage=60&with_categories=true&with_colors=true&with_product_colors=true&with_sizes=true&with_brands=true&with_prices=true&with_tags=1'
try{
 const raw=await safeRequest(sampleListUrl,{accept:'application/json',timeout:12000})
 const payload=JSON.parse(raw.body)
 const sample=payload?.products?.[0],seller=payload?.meta?.seller_id
 console.info('VESTI_FIELDS',JSON.stringify({
  id:sample?.id,priceType:typeof sample?.price,pricesSize:sample?.prices?.length,
  pricesSample:sample?.prices?.[0],
  colorsSize:sample?.colors?.length,tagsSize:sample?.tags?.length,
  mediaSize:sample?.media?.length,stockout:sample?.stockout,
  companyIdFromBody:/(?:(?:companyId)|(?:company_id))/.test(raw.body),
 }))
 if(sample?.id && seller) {
  const u='https://apivesti.vesti.mobi/appmarca/v1/products/company/'+encodeURIComponent(seller)+'/product/'+encodeURIComponent(sample.id)+'/showcase?cid=3d65968050c8488&reseller_id=null'
  const result=await safeRequest(u,{accept:'application/json',timeout:12000})
  let val;try{val=JSON.parse(result.body)}catch{}
  console.info('VESTI_DETAIL_DIAG',JSON.stringify({
   status:result.status,length:result.body.length,keys:Object.keys(val||{}).slice(0,30),
   productKeys:Object.keys(val?.product_group||val?.product||{}).slice(0,40),
  }))
 }
}catch(e){console.warn('VESTI_DETAIL_DIAG',JSON.stringify({error:String(e?.message||e).slice(0,200)}))}
