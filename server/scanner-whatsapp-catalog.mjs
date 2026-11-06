// WhatsApp Business catalog import through a connected Evolution API instance.
// A wa.me/c link is an app deep link, not an HTML product feed.
export function whatsappCatalogPhone(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { return null }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'wa.me' ||
      url.port || url.username || url.password || url.search || url.hash) return null
  const match = /^\/c\/(\d{10,15})\/?$/.exec(url.pathname)
  return match?.[1] || null
}

export function isWhatsAppCatalogLink(raw) {
  return whatsappCatalogPhone(raw) !== null
}

function moneyFromWhatsApp(product) {
  // WhatsApp stores monetary amounts as integers in thousandths.
  for (const key of ['salePriceAmount1000', 'sale_price_amount_1000', 'priceAmount1000', 'price_amount_1000']) {
    const raw = product?.[key]
    if (raw != null && /^\d+$/.test(String(raw).trim())) return Number(raw) / 1000
  }
  // Some connectors explicitly return prices in major currency units.
  if (product?.price != null && typeof product.price === 'string' &&
      /^(?:\d{1,9}[.,]\d{1,2}|\d{1,9})$/.test(product.price.trim())) {
    const normalized = product.price.trim().replace(',', '.')
    const amount = Number(normalized)
    return Number.isFinite(amount) ? amount : null
  }
  return null
}

function publicImage(raw) {
  const item = typeof raw === 'string' ? raw :
    raw && typeof raw === 'object' ? raw.url || raw.directPathUrl || raw.imageUrl || raw.image_url || raw.originalUrl || raw?.productImage?.url : ''
  if (typeof item !== 'string') return ''
  try {
    const uri = new URL(item)
    return uri.protocol === 'https:' && !uri.username && !uri.password && !uri.port && !['localhost','127.0.0.1'].includes(uri.hostname)
      ? uri.toString().slice(0,2048) : ''
  } catch { return '' }
}

export function normalizeWhatsAppCatalogPayload(payload, phone, sourceUrl) {
  const raw = Array.isArray(payload) ? payload
    : Array.isArray(payload?.catalog) ? payload.catalog
    : Array.isArray(payload?.products) ? payload.products
    : Array.isArray(payload?.data?.catalog) ? payload.data.catalog
    : Array.isArray(payload?.data?.products) ? payload.data.products
    : Array.isArray(payload?.result?.catalog) ? payload.result.catalog
    : Array.isArray(payload?.result?.products) ? payload.result.products : []
  const seen = new Set()
  const candidates = []
  for (const product of raw.slice(0, 500)) {
    if (!product || typeof product !== 'object') continue
    const title = String(product.name || product.title || '').trim().slice(0,500)
    if (!title) continue
    const id = String(product.id || product.productId || product.product_id || product.retailerId || product.retailer_id || '').trim().slice(0,120)
    const unique = id || title.toLowerCase()
    if (seen.has(unique)) continue
    seen.add(unique)
    const images = [
      ...(Array.isArray(product.images) ? product.images : []),
      ...(Array.isArray(product.productImages) ? product.productImages : []),
      product.image, product.productImage, product.imageUrl, product.image_url, product.thumbnail, product.thumbnailUrl,
    ].map(publicImage).filter(Boolean).slice(0,30)
    const price = moneyFromWhatsApp(product)
    const specificUrl = id && /^\d+$/.test(id) ? 'https://wa.me/p/'+id+'/'+phone : sourceUrl
    candidates.push({
      source_url: specificUrl,external_id: id,title,
      description:String(product.description || '').trim().slice(0,12000),
      sku:String(product.retailerId || product.retailer_id || product.sku || '').trim().slice(0,200),
      category:String(product.category || product.collectionName || '').trim().slice(0,300),
      images,price,price_text:price == null ? '' : String(price),
      currency:String(product.currencyCode || product.currency_code || product.currency || 'BRL').slice(0,20),
      availability:product.isHidden ? 'oculto' : '',source:'whatsapp-evolution',
    })
  }
  return candidates
}

export function evolutionCatalogConfig(env = process.env) {
  const base = String(env.SHOPVAX_WHATSAPP_EVOLUTION_URL || '').trim()
  const instance = String(env.SHOPVAX_WHATSAPP_EVOLUTION_INSTANCE || '').trim()
  const apiKey = String(env.SHOPVAX_WHATSAPP_EVOLUTION_API_KEY || '').trim()
  if (!base || !instance || !apiKey) throw new Error(
    'Importação WhatsApp: configure SHOPVAX_WHATSAPP_EVOLUTION_URL, SHOPVAX_WHATSAPP_EVOLUTION_INSTANCE e SHOPVAX_WHATSAPP_EVOLUTION_API_KEY no backend. O link wa.me/c sozinho não fornece os produtos.'
  )
  let u
  try { u = new URL(base) } catch { throw new Error('URL da Evolution API inválida.') }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      u.port || u.pathname !== '/' || !/^[a-z0-9.-]+$/i.test(u.hostname) ||
      /^(?:localhost|.*\.local|.*\.internal)$/i.test(u.hostname) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) || u.hostname.includes(':')) {
    throw new Error('Configure uma origem HTTPS pública válida da Evolution API, sem portas ou caminhos.')
  }
  if (!/^[\w-]{1,100}$/.test(instance)) throw new Error('Identificador da instância Evolution inválido.')
  return { url:new URL('/business/getCatalog/'+encodeURIComponent(instance),u).toString(), apiKey }
}

export async function collectWhatsAppCatalog(sourceUrl, options={}) {
  const phone=whatsappCatalogPhone(sourceUrl)
  if (!phone) throw new Error('Informe o link completo do catálogo no formato https://wa.me/c/55DDDNUMERO.')
  const config=evolutionCatalogConfig(options.env || process.env)
  if (typeof options.request !== 'function') throw new Error('Transporte seguro não configurado.')
  const response=await options.request(config.url,{
    method:'POST',followRedirects:false,accept:'application/json',maxBytes:5*1024*1024,timeout:18000,
    headers:{apikey:config.apiKey,'content-type':'application/json'},
    body:JSON.stringify({number:phone,limit:200}),
  })
  if (!response?.ok) {
    if (response?.status===401 || response?.status===403) throw new Error('A instância Evolution não autorizou a consulta do catálogo. Confira a chave e as permissões.')
    if ([429,500,502,503,504].includes(response?.status)) throw new Error('A Evolution ou o WhatsApp não conseguiu consultar o catálogo agora. Verifique a conexão da instância.')
    throw new Error('A Evolution não conseguiu consultar este catálogo (HTTP '+(response?.status||'indisponível')+').')
  }
  let payload
  try {payload=JSON.parse(response.body)}catch{throw new Error('A Evolution não retornou dados JSON de catálogo válidos.')}
  const candidates=normalizeWhatsAppCatalogPayload(payload,phone,sourceUrl)
  if (!candidates.length) throw new Error(
    'O WhatsApp não retornou produtos para este número. Confirme que o catálogo está ativo e que a instância Evolution consegue consultar este perfil Business.'
  )
  if (typeof options.onBatch==='function') await options.onBatch(candidates)
  if (typeof options.onProgress==='function') await options.onProgress({progress:90,pagesScanned:1,candidates:candidates.length,platform:'whatsapp'})
  return {platform:'whatsapp',pagesScanned:1,candidateCount:candidates.length,
    candidates:options.collectInMemory===false?[]:candidates}
}
