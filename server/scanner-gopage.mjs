import { load } from 'cheerio'

const MAX_IMAGES = 40
const MAX_VARIANTS = 200
const text = value => String(value ?? '').replace(/\s+/g,' ').trim()
const list = value => Array.isArray(value) ? value : []
function positivePrice(value) {
  if(value == null || value === '') return null
  const raw=String(value).trim().replace(/[R$\s]/g,'')
  const parsed=raw.includes(',')?Number(raw.replace(/\./g,'').replace(',','.')):Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
function url(value,base) {
 try {
  if(!text(value))return ''
  const result=new URL(typeof value === 'string'?value:String(value||''),base)
  return ['http:','https:'].includes(result.protocol) && !result.username && !result.password ? result.toString() : ''
 } catch { return '' }
}
function images(value,base) {
 const result=[],seen=new Set()
 const visit=(input,depth=0)=>{
  if(input == null || depth>4 || result.length>=MAX_IMAGES)return
  if(Array.isArray(input)){for(const item of input)visit(item,depth+1);return}
  if(typeof input==='object'){
   // GoPage supplies both full-sized "url" and its derivative "thumb".
   // Import just the original, never two gallery photos for the same shot.
   const preferred=['original','full','large','url','src','image_url','imageUrl','image','photo']
   for(const key of preferred){
    if(input[key]==null)continue
    const before=result.length
    visit(input[key],depth+1)
    if(result.length>before)return
   }
   if(input.thumb!=null)visit(input.thumb,depth+1)
   return
  }
  const found=url(input,base)
  if(found && !seen.has(found)){seen.add(found);result.push(found)}
 }
 visit(value)
 return result
}
function categoryName(entry) {
 return text(typeof entry==='string'?entry:entry?.name || entry?.title)
}
function variantOf(entry,product,base,priceVisible) {
 if(!entry||typeof entry!=='object')return null
 const attrs=Array.isArray(entry.attributes)?entry.attributes:[]
 const size=text(entry.size?.name ?? entry.size ?? entry.tamanho)
 const color=text(entry.color?.name ?? entry.color ?? entry.cor)
 const props=attrs.filter(x=>x&&typeof x==='object'&&x.name&&x.value).map(x=>({name:text(x.name),value:text(x.value)}))
 if(size)props.push({name:'Tamanho',value:size})
 if(color)props.push({name:'Cor',value:color})
 return {
  external_id:text(entry.id??entry.variation_id??entry.variant_id),
  title:text(entry.name??entry.title??entry.label),
  sku:text(entry.sku??entry.code??entry.reference),
  color,size,
  price:priceVisible?positivePrice(entry.sale_price??entry.price??product.price):null,
  available:entry.available_to_purchase !== false && entry.in_stock !== false && Number(entry.stock_quantity??1)!==0,
  images:images([entry.images,entry.image,entry.variation_images],base),
  properties:props,
 }
}
function gopageVariants(product,base,visible) {
 const data=Array.isArray(product.variations)?product.variations:
   product.variations && typeof product.variations==='object'?Object.values(product.variations):[]
 return data.slice(0,MAX_VARIANTS).map(x=>variantOf(x,product,base,visible)).filter(Boolean)
}
function priceTiers(product,visible) {
 if(!visible)return ''
 const tiers=list(product.price_tiers).map(x=>({
   quantity:Number(x.min_quantity??x.quantity),
   price:positivePrice(x.unit_price??x.price),
 })).filter(x=>Number.isInteger(x.quantity)&&x.quantity>0&&x.price!=null)
 return tiers.length?'\nPreços por quantidade: '+tiers.map(x=>x.quantity+'+ un. R$ '+x.price.toFixed(2).replace('.',',')).join('; '):''
}
export function parseGopageInertia(html) {
 const node=load(String(html||''))('[data-page]').first()
 if(!node.length)return null
 try{
  const obj=JSON.parse(node.attr('data-page')||'')
  if(!obj?.props || typeof obj.props !== 'object')return null
  if(!obj.props.productsList && !obj.props.product)return null
  return obj.props
 }catch{return null}
}
export function gopageProducts(props,baseUrl) {
 const page=props?.page || {}
 const raw=props?.productsList?.products
 const products=Array.isArray(raw)?raw:props?.product?[props.product]:[]
 return products.filter(x=>x&&typeof x==='object'&&x.hidden!==true&&text(x.name??x.title)).map(item=>{
  const origin=new URL(baseUrl).origin
  const productUrl=url(item.url || (item.slug ? '/produto/'+encodeURIComponent(item.slug) : ''),origin)
  const sameOrigin=productUrl && new URL(productUrl).origin===origin?productUrl:baseUrl
  // Price unlocks may be required even if the server sends numerical values
  // in embedded JSON. Never expose prices not visible to a public visitor.
  const canShowPrice=page.prices_unlocked !== false && item.price_hidden !== true
  const price=canShowPrice ? positivePrice(item.sale_price??item.cheapest_variation_price??item.price) : null
  const variants=gopageVariants(item,baseUrl,canShowPrice)
  const fields=list(item.attributes)
  const groups=fields.filter(x=>x&&x.name).map(x=>({
    name:text(x.name),values:list(x.values).map(y=>text(y.name??y.value??y)).filter(Boolean),
  })).filter(x=>x.values.length)
  const allImages=images([item.images,item.image,item.variation_images,variants.flatMap(v=>v.images)],baseUrl)
  const categories=list(item.categories)
  return {
   source_url:sameOrigin,
   external_id:text(item.id??item.external_id??item.slug),
   title:text(item.name??item.title),
   description:text(item.description??item.long_description) + priceTiers(item,canShowPrice),
   sku:text(item.sku??item.ean??item.reference),
   category:categoryName(categories[0]??props?.category),
   images:allImages,
   variants,
   properties:groups,
   price,
   price_text:price==null?(canShowPrice?'':'Preço sob consulta'):String(price),
   currency:'BRL',
   availability:item.available_to_purchase===false||item.active===false?'OutOfStock':'InStock',
   source:'gopage-inertia',
  }
 })
}
export function gopagePagination(props) {
 const info=props?.productsList?.pagination
 if(!info)return null
 const current=Number(info.current_page??1)
 const totalPages=Number(info.total_pages??info.last_page)
 const hasMore=info.has_more_pages === true ||
  (Number.isInteger(totalPages)&&current<totalPages)
 return {
  current:Number.isInteger(current)&&current>0?current:1,
  totalPages:Number.isInteger(totalPages)&&totalPages>0?totalPages:null,
  total:Number.isInteger(Number(info.total))&&Number(info.total)>=0?Number(info.total):null,
  hasMore,
 }
}
export function gopageCategoryUrls(props,baseUrl) {
 const origin=new URL(baseUrl).origin
 const categories=list(props?.categories)
 const result=[],seen=new Set()
 const visit=(items,depth=0)=>{
  if(depth>6||result.length>=2000)return
  for(const item of list(items)){
   const candidate=url(item?.url||(item?.slug?'/categoria/'+encodeURIComponent(item.slug):''),origin)
   if(candidate && new URL(candidate).origin===origin && !seen.has(candidate)){
    seen.add(candidate);result.push(candidate)
   }
   visit(item?.children,depth+1)
  }
 }
 visit(categories)
 return result
}
async function mapLimit(values,concurrency,mapper) {
 const result=new Array(values.length);let cursor=0
 await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{
  while(cursor<values.length){const i=cursor++;result[i]=await mapper(values[i],i)}
 }))
 return result
}
export async function collectGopage(rootResponse, request, maxProducts, maxPages, sink, onProgress) {
 const origin=new URL(rootResponse.url).origin
 const root=parseGopageInertia(rootResponse.body)
 if(!root)throw new Error('A GoPage não retornou os dados estruturados da vitrine pública.')
 const categories=gopageCategoryUrls(root,rootResponse.url)
 const starts=[rootResponse.url]
 // A category URL must remain scoped to that category, not silently expand
 // into every sibling category; only the storefront root can widen scope.
 if(new URL(rootResponse.url).pathname.replace(/\/+$/, '') === '' && categories.length)starts.push(...categories)
 const visited=new Set()
 let pagesScanned=0, listingPages=0, expectedOnRoot=null, detailFailures=0, listingFailures=0, lastListingExhausted=false
 for(const start of starts){
  if(start!==rootResponse.url && expectedOnRoot!=null && sink.count>=expectedOnRoot)break
  if(sink.count>=maxProducts || listingPages>=maxPages)break
  let page=1
  const signatureSet=new Set()
  while(sink.count<maxProducts && listingPages<maxPages){
   const target=new URL(start)
   if(page>1)target.searchParams.set('page',String(page))
   const pageUrl=target.toString()
   if(visited.has(pageUrl))break
   visited.add(pageUrl)
   let response
   try { response=page===1&&start===rootResponse.url?rootResponse:await request(pageUrl,{accept:'text/html,application/xhtml+xml'}) }
   catch(error){listingFailures++;throw new Error('GoPage: falha ao consultar a página '+page+' do catálogo: '+error.message)}
   pagesScanned++
   listingPages++
   if(!response.ok)throw new Error('GoPage: página '+page+' retornou HTTP '+response.status+'.')
   const props=parseGopageInertia(response.body)
   if(!props)throw new Error('GoPage: a página '+page+' não retornou catálogo estruturado.')
   const pagination=gopagePagination(props)
   if(pagination && pagination.current!==page)
     throw new Error('GoPage: o catálogo repetiu a página '+pagination.current+' ao solicitar '+page+'.')
   if(start===rootResponse.url && page===1)expectedOnRoot=pagination?.total??null
   const batch=gopageProducts(props,response.url)
   const signature=batch.map(p=>p.external_id||p.source_url).join('|')
   if(signatureSet.has(signature) && signature)throw new Error('GoPage: paginação repetiu produtos na página '+page+'.')
   if(signature)signatureSet.add(signature)
   const enriched=await mapLimit(batch,4,async(item)=>{
    const needsDetail=(!item.description || item.images.length===0 || (!item.variants.length && props.productsList?.products?.find(p=>String(p.id)===item.external_id)?.has_variations===true))
    if(!needsDetail || !item.source_url || new URL(item.source_url).origin!==origin)return item
    try{
      const res=await request(item.source_url,{accept:'text/html,application/xhtml+xml'})
      pagesScanned++
      if(!res.ok)return item
      const detail=parseGopageInertia(res.body)
      if(!detail?.product)return item
      const complete=gopageProducts(detail,res.url)[0]
      if(!complete || complete.external_id!==item.external_id)return item
      return {...item,description:complete.description||item.description,
        images:complete.images.length?complete.images:item.images,
        variants:complete.variants.length?complete.variants:item.variants,
        properties:complete.properties.length?complete.properties:item.properties}
    }catch{detailFailures++;return item}
   })
   await sink.push(enriched)
   await onProgress({progress:Math.min(90,15+Math.floor(Math.log2(page+1)*8)),pagesScanned,candidates:sink.count,platform:'gopage'})
   if(!pagination?.hasMore || !batch.length){ lastListingExhausted=true; break }
   if(pagination.totalPages && page>=pagination.totalPages){lastListingExhausted=true;break}
   page++
  }
 }
 // For home URLs, a known public total is a useful completeness guarantee.
 if(starts.length===1 && expectedOnRoot!=null &&
   sink.count<expectedOnRoot && sink.count<maxProducts && listingPages<maxPages){
   throw new Error('GoPage: importação parcial. Encontrados '+sink.count+' de '+expectedOnRoot+' produtos públicos.')
 }
 await sink.flush()
 const catalogComplete = expectedOnRoot != null ? sink.count>=expectedOnRoot : lastListingExhausted
 const warnings=[]
 if(!catalogComplete)warnings.push('A vitrine não confirmou que todos os produtos foram recuperados.')
 if(detailFailures)warnings.push(detailFailures+' páginas de detalhes indisponíveis')
 return {candidateCount:sink.count,pagesScanned,expectedProducts:expectedOnRoot,
  complete:catalogComplete && listingFailures===0 && detailFailures===0,
  warnings}
}
