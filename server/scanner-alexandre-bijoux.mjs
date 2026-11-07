/**
 * Public Alexandre Bijoux catalog adapter.
 * Only uses the APIs linked by the public storefront /assets/app.js.
 * Does not perform login or retrieve any visitor-specific information.
 */
const str = value => String(value ?? '').trim()
const list = value => Array.isArray(value) ? value : []
function publicImage(value, origin) {
  try {
    if(!str(value)) return ''
    const url=new URL(str(value), origin)
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password) return ''
    return url.toString()
  } catch { return '' }
}
export function isAlexandreBijouxStorefront(sourceUrl) {
  try {
    return ['bijouxalexandre.com.br','www.bijouxalexandre.com.br']
      .includes(new URL(sourceUrl).hostname.toLowerCase())
  } catch { return false }
}
export function alexandreProduct(item, category, origin) {
  if(!item || typeof item!=='object' || !str(item.id) || !str(item.nome)) return null
  const images=[item.imagemUrl, ...list(item.imagens), ...list(item.fotos)]
    .map(value => publicImage(typeof value==='object' ? (value?.url || value?.imagemUrl || value?.src) : value, origin))
    .filter(Boolean)
  const price=Number(item.precoPor)
  return {
    source_url: origin + '/',
    external_id: str(item.id),
    title: str(item.nome),
    description: str(item.descricao),
    sku: str(item.sku ?? item.referencia ?? item.codigo),
    category: str(category?.nome || item.categoriaNome) || 'Geral',
    brand: 'Alexandre Bijoux',
    images: [...new Set(images)],
    variants: [],
    properties: [],
    price: Number.isFinite(price) && price > 0 ? price : null,
    price_text: Number.isFinite(price) && price > 0 ? String(price) : '',
    currency: 'BRL',
    availability: '',
    source: 'alexandre-bijoux-public-api',
  }
}
export async function collectAlexandreBijoux(rootResponse, request, maxProducts, sink, onProgress) {
  const origin=new URL(rootResponse.url).origin
  const json=async(path)=>{
    const r=await request(new URL(path,origin).toString(),{accept:'application/json'})
    if(!r.ok)throw new Error('Alexandre Bijoux: API pública retornou HTTP '+r.status+' em '+path+'.')
    if(!String(r.contentType||'').includes('json'))
      throw new Error('Alexandre Bijoux: a rota '+path+' não retornou JSON.')
    try { return JSON.parse(r.body) }
    catch { throw new Error('Alexandre Bijoux: JSON inválido na rota '+path+'.') }
  }
  const categories=await json('/api/categorias')
  if(!Array.isArray(categories) || !categories.length)
    throw new Error('Alexandre Bijoux: a API não retornou categorias públicas.')
  const seen=new Set()
  let pagesScanned=2
  let expected=0
  let stoppedByLimit=false
  for(const category of categories){
    const id=str(category?.id)
    if(!id)throw new Error('Alexandre Bijoux: categoria pública sem identificador.')
    if(sink.count>=maxProducts){stoppedByLimit=true;break}
    const payload=await json('/api/categorias/'+encodeURIComponent(id)+'/produtos')
    pagesScanned++
    if(!Array.isArray(payload?.produtos))
      throw new Error('Alexandre Bijoux: resposta sem lista de produtos para '+str(category.nome)+'.')
    const products=payload.produtos
    const advertised=Number(category.totalPecas)
    if(Number.isInteger(advertised) && advertised >= 0 && products.length!==advertised)
      throw new Error('Alexandre Bijoux: categoria '+str(category.nome)+' retornou '+products.length+' de '+advertised+' produtos anunciados.')
    expected+=products.length
    const batch=[]
    for(const item of products){
      const product=alexandreProduct(item,category,origin)
      if(!product)throw new Error('Alexandre Bijoux: produto sem identificação ou nome em '+str(category.nome)+'.')
      if(seen.has(product.external_id))continue
      seen.add(product.external_id)
      batch.push(product)
    }
    await sink.push(batch)
    await onProgress({progress:Math.min(90,15+Math.round(pagesScanned/(categories.length+2)*75)),pagesScanned,candidates:sink.count,platform:'alexandre-bijoux'})
  }
  await sink.flush()
  if(!sink.count)throw new Error('Alexandre Bijoux: a API pública não retornou produtos para revisão.')
  const complete=!stoppedByLimit && seen.size===sink.count
  return {
    candidateCount:sink.count,pagesScanned,expectedProducts:expected,complete,
    warnings:complete?[]:['Limite de produtos atingido antes da leitura de todas as categorias.'],
  }
}
