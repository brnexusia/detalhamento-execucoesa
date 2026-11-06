// Public, unauthenticated VTEX legacy product search. Read-only. Some stores
// block this API or use Intelligent Search instead; callers should fall back
// to the generic storefront crawler without inventing a product.
function text(raw) { return String(raw??'').trim() }
function money(raw) {
  const n=Number(raw)
  return raw!=null&&text(raw)!==''&&Number.isFinite(n)&&n>0&&n<1e8?n:null
}
function safeImage(raw) {
  try {
    const u=new URL(raw)
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port ? u.toString().slice(0,2048) : ''
  }catch{return ''}
}
function sameOrigin(raw,origin) {
  try{
    const u=new URL(raw,origin)
    return u.protocol==='https:'&&u.origin===origin&&u.pathname.length>1
      ? u.origin+u.pathname : ''
  }catch{return ''}
}
export function normalizeVtexPublicProducts(data, origin) {
  if(!Array.isArray(data))throw new Error('VTEX não retornou lista JSON de produtos.')
  const result=[]
  const seen=new Set()
  for(const p of data){
    const title=text(p?.productName).slice(0,500)
    if(!title)continue
    const pid=text(p?.productId)
    if(pid && seen.has(pid))continue
    if(pid)seen.add(pid)
    const items=Array.isArray(p.items)?p.items:[]
    const images=[...new Set(items.flatMap(item=>Array.isArray(item.images)?item.images.map(img=>safeImage(img?.imageUrl||img?.imageUrlTag||'')):[]).filter(Boolean))].slice(0,40)
    const variants=[]
    for(const item of items.slice(0,150)){
      const sellers=Array.isArray(item.sellers)?item.sellers:[]
      const seller=sellers.find(x=>x?.sellerDefault)||sellers[0]
      const offer=seller?.commertialOffer||{}
      const price=money(offer.Price)
      const values=(Array.isArray(item.variations)?item.variations:[])
        .flatMap(key=>Array.isArray(item?.[key])?item[key].map(value=>({name:text(key),value:text(value)})):[])
        .filter(k=>k.name&&k.value)
      variants.push({
        id:text(item.itemId),sku:text(item.referenceId?.[0]?.Value||item.itemId),
        title:text(item.name||item.nameComplete||''),
        price,available:Number(offer.AvailableQuantity||0)>0,
        properties:values,
        images:(Array.isArray(item.images)?item.images.map(img=>safeImage(img?.imageUrl||'')).filter(Boolean):[]).slice(0,20),
      })
    }
    const priced=variants.map(v=>v.price).filter(v=>v!==null)
    const price=priced.length?Math.min(...priced):null
    const specific=sameOrigin(p?.link||'',origin)
    const slug=text(p?.linkText).replace(/^\/|\/$/g,'')
    const url=specific||((/^[a-z0-9][a-z0-9._-]{2,180}$/i.test(slug))?origin+'/'+slug+'/p':origin+'/')
    result.push({
      source_url:url,external_id:pid,title,description:text(p?.description).slice(0,12000),
      sku:text(p?.productReference).slice(0,150),category:text(p?.categories?.[0]).replace(/^\/|\/$/g,'').slice(0,200),
      brand:text(p?.brand).slice(0,150),images,variants,
      price,price_text:price==null?'':String(price),currency:'BRL',
      availability:'',source:'vtex-public-search',
    })
  }
  return result
}

export async function collectVtexPublic({ rootResponse, request, maxProducts, sink, onProgress }) {
  const origin=new URL(rootResponse.url).origin
  const bounded=Number.isFinite(maxProducts)?Math.max(1,Math.floor(maxProducts)):2500
  let count=0
  let scanned=0
  for(let page=0;page<125 && count<bounded;page++){
    const from=page*20
    const to=from+19
    const response=await request(origin+'/api/catalog_system/pub/products/search?_from='+from+'&_to='+to,{
      accept:'application/json',maxBytes:8*1024*1024,timeout:12000,
    })
    if(!response.ok){
      if(!count)throw new Error('A loja VTEX não disponibilizou sua API pública de catálogo.')
      throw new Error('O catálogo VTEX foi interrompido antes de concluir a paginação.')
    }
    const data=JSON.parse(response.body)
    if(!Array.isArray(data))throw new Error('Resposta de catálogo VTEX sem array de produtos.')
    scanned++
    if(!data.length)break
    const items=normalizeVtexPublicProducts(data,origin).slice(0,bounded-count)
    if(!items.length&&page===0)throw new Error('A API VTEX não retornou produtos utilizáveis.')
    await sink.push(items)
    count+=items.length
    await onProgress({progress:Math.min(88,10+Math.round((page+1)*.6)),
      pagesScanned:scanned,candidates:sink.count,platform:'vtex'})
    if(data.length<20)break
    if(page===124 && count<bounded)throw new Error(
      'A busca pública da VTEX atingiu seu limite de paginação. Importe por categoria para não perder produtos.')
  }
  await sink.flush()
  return {candidateCount:sink.count,pagesScanned:scanned}
}
