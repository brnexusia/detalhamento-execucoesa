// WhatsApp Business catalog reader using the official UAZAPI catalog-list contract.
import crypto from 'node:crypto'
// All requests run server-side with a configured instance token; the user supplies
// only a public wa.me/c link. No scraping, inferred products or auto-publication.
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

export function uazapiCatalogConfig(env = process.env) {
  const base = String(env.SHOPVAX_WHATSAPP_UAZAPI_URL || '').trim()
  const token = String(env.SHOPVAX_WHATSAPP_UAZAPI_TOKEN || '').trim()
  if (!base || !token) throw new Error(
    'Importação WhatsApp: configure SHOPVAX_WHATSAPP_UAZAPI_URL e SHOPVAX_WHATSAPP_UAZAPI_TOKEN no backend. Use o token de uma instância UAZAPI conectada, não o token administrativo.'
  )
  let url
  try { url = new URL(base) } catch { throw new Error('URL da UAZAPI inválida.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.port || url.pathname !== '/' || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      /^(?:localhost|.*\.local|.*\.internal)$/i.test(url.hostname) ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new Error('Configure a origem HTTPS pública da UAZAPI, sem caminho, porta personalizada ou parâmetros.')
  }
  return { url: new URL('/business/catalog/list', url).toString(), token }
}

function amountInThousandths(value) {
  // UAZAPI BusinessProduct.price and sale_price.price are integer strings
  // representing 1/1000 of the currency (19990 = R$ 19,99).
  if (typeof value !== 'string' || !/^\d{1,18}$/.test(value)) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return Math.round(number / 10) / 100
}

function productPrice(product) {
  const base = amountInThousandths(product?.price)
  const sale = amountInThousandths(product?.sale_price?.price)
  if (sale == null) return base
  const start = product?.sale_price?.start_date ? Date.parse(product.sale_price.start_date) : null
  const end = product?.sale_price?.end_date ? Date.parse(product.sale_price.end_date) : null
  // Never silently assume an expired promotion is still active.
  if ((start != null && (!Number.isFinite(start) || Date.now() < start)) ||
      (end != null && (!Number.isFinite(end) || Date.now() >= end))) return base
  return sale
}

function publicImage(raw) {
  const str = typeof raw === 'string' ? raw :
    raw && typeof raw === 'object' ? raw.original_image_url || raw.request_image_url || raw.url : ''
  if (typeof str !== 'string') return ''
  try {
    const url = new URL(str)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.hostname === 'localhost' || url.hostname.endsWith('.local')) return ''
    return url.toString().slice(0, 2048)
  } catch { return '' }
}

function whatsappImageSources(product) {
  if (!Array.isArray(product?.media?.images)) return []
  return product.media.images.map((item) => {
    const choices = typeof item === 'string'
      ? [item]
      : [item?.original_image_url, item?.request_image_url, item?.url]
    return [...new Set(choices.map(publicImage).filter(Boolean))]
  }).filter((choices) => choices.length).slice(0, 30)
}

export function normalizeWhatsAppCatalogPayload(payload, phone, sourceUrl) {
  // UAZAPI 2.6.x returns {response:{products:[...],next?:string}}.
  const products = payload?.response?.products
  if (!Array.isArray(products)) throw new Error('Resposta da UAZAPI sem response.products. Verifique a versão da API.')
  const candidates = []
  const seen = new Set()
  for (const product of products) {
    if (!product || typeof product !== 'object') continue
    const title = String(product.name || '').trim().slice(0,500)
    if (!title) continue
    const id = String(product.id || product.retailer_id || '').trim().slice(0,120)
    const unique = id || title.toLowerCase()
    if (seen.has(unique)) continue
    seen.add(unique)
    const imageSources = whatsappImageSources(product)
    const images = [...new Set(imageSources.map((choices) => choices[0]))]
    const price = productPrice(product)
    const sourceProductUrl = id && /^\d+$/.test(id)
      ? 'https://wa.me/p/'+id+'/'+phone
      : sourceUrl + '#item-' + encodeURIComponent(id || title.toLowerCase().replace(/\s+/g,'-').slice(0,90))
    candidates.push({
      source_url: sourceProductUrl, external_id:id, title,
      description: String(product.description || '').trim().slice(0,12000),
      sku: String(product.retailer_id || '').trim().slice(0,200),
      category:'', brand:'', images,
      // Scan-only alternatives: the original WhatsApp CDN link may be expired.
      whatsapp_image_sources:imageSources,
      price,price_text:price == null ? '' : String(price),
      currency: String(product.currency || 'BRL').slice(0,20),
      availability: String(product.product_availability || (product.is_hidden ? 'oculto' : '')).slice(0,200),
      source:'whatsapp-uazapi',
    })
  }
  return candidates
}

async function saveWhatsAppCatalogImages(candidates, options) {
  // Keep the existing pure catalog parser useful for diagnostics/tests without
  // database access. In production onImage writes validated bytes to /media.
  if (typeof options.onImage !== 'function' || !candidates.length) return
  const fetchImage = options.fetchImage ||
    (await import('./import-media-localizer.mjs')).fetchImportImage
  const cache = new Map()
  let nextIndex = 0
  let processed = 0
  let localized = 0
  let unavailable = 0

  function saveImage(url) {
    if (!cache.has(url)) {
      const task = (async () => {
        const image = await fetchImage(url, { request: options.request })
        if (!Buffer.isBuffer(image?.buffer) || !/^image\/(jpeg|png|webp|gif|avif)$/.test(image?.mimeType || '')) {
          throw new Error('Mídia do catálogo não é uma imagem válida.')
        }
        const ext = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp',
          'image/gif':'gif', 'image/avif':'avif' }[image.mimeType]
        const stored = await options.onImage(
          image.buffer, image.mimeType, 'whatsapp-catalog-' + crypto.randomUUID() + '.' + ext,
        )
        if (!/^\/media\/[A-Za-z0-9_-]+$/.test(stored || '')) {
          throw new Error('Armazenamento local de imagem indisponível.')
        }
        return stored
      })()
      cache.set(url, task)
    }
    return cache.get(url)
  }

  async function worker() {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex++]
      const groups = Array.isArray(candidate.whatsapp_image_sources)
        ? candidate.whatsapp_image_sources : []
      const stored = []
      for (const urls of groups) {
        let local = ''
        for (const url of urls) {
          try {
            local = await saveImage(url)
            break
          } catch {
            // Try the alternate URL furnished by UAZAPI for this same photo.
          }
        }
        if (local) stored.push(local)
        else unavailable += 1
      }
      if (stored.length) {
        candidate.images = [...new Set(stored)]
        localized += stored.length
      }
      // Only the normalized local /media paths or the original public URLs
      // are stored in the import_candidates records; not these alternatives.
      delete candidate.whatsapp_image_sources
      processed += 1
      if (processed % 25 === 0 || processed === candidates.length) {
        await options.onProgress?.({
          progress: 85 + Math.floor(5 * processed / candidates.length),
          pagesScanned: options.pagesScanned || 0,
          candidates: candidates.length,
          platform: 'whatsapp',
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()))
  if (unavailable) {
    // Do not put temporary signed photo URLs, tokens or phone numbers in logs.
    console.warn('[scanner whatsapp] catalog images unavailable', {
      unavailable, localized, products: candidates.length,
    })
  }
}

export async function collectWhatsAppCatalog(sourceUrl, options={}) {
  const phone = whatsappCatalogPhone(sourceUrl)
  if (!phone) throw new Error('Use o link do catálogo no formato https://wa.me/c/55DDDNUMERO.')
  const {url,token} = uazapiCatalogConfig(options.env || process.env)
  if (typeof options.request !== 'function') throw new Error('Transporte seguro do scanner não configurado.')
  const onProgress = options.onProgress || (async()=>{})
  const all = []
  const allIds = new Set()
  const seenCursors = new Set()
  let cursor = ''
  let count = 0
  let page = 0
  const maxPages = 40 // 2.000 products, at most 50 products/page per UAZAPI docs.
  while (page < maxPages) {
    page += 1
    const body = {jid:phone+'@s.whatsapp.net'}
    if (cursor) body.after = cursor
    const response = await options.request(url, {
      method:'POST', followRedirects:false,accept:'application/json',
      maxBytes:5*1024*1024, timeout:18000,
      headers:{token, 'content-type':'application/json'},
      body:JSON.stringify(body),
    })
    if (!response?.ok) {
      if ([401,403].includes(response?.status)) throw new Error('A UAZAPI recusou o token da instância. Confira a autenticação e conexão.')
      if ([429,500,502,503,504].includes(response?.status)) throw new Error('A UAZAPI ou o WhatsApp não respondeu à consulta do catálogo. Confira a instância conectada.')
      throw new Error('A UAZAPI não conseguiu consultar o catálogo (HTTP '+(response?.status||'indisponível')+').')
    }
    let payload
    try {payload=JSON.parse(response.body)}catch{throw new Error('A UAZAPI retornou JSON inválido do catálogo.')}
    const products=normalizeWhatsAppCatalogPayload(payload,phone,sourceUrl)
    const fresh=products.filter(item=>{
      const key=item.external_id || item.source_url
      if(allIds.has(key))return false
      allIds.add(key)
      return true
    })
    // Do not publish partial data if pagination fails halfway through.
    all.push(...fresh)
    count+=fresh.length
    const next=payload.response?.next
    if (next != null && typeof next !== 'string') throw new Error('Cursor inválido da UAZAPI; importação interrompida para revisão.')
    if(!next) break
    if(seenCursors.has(next))throw new Error('Paginação repetida da UAZAPI; importação interrompida.')
    seenCursors.add(next)
    cursor=next
    if(page===maxPages)throw new Error('Catálogo excede o limite seguro de páginas desta importação.')
    await onProgress({progress:Math.min(85,10+page*2),pagesScanned:page,candidates:count,platform:'whatsapp'})
  }
  if(!all.length)throw new Error('A UAZAPI não encontrou produtos. Confira o catálogo público e o acesso da instância WhatsApp conectada.')
  await saveWhatsAppCatalogImages(all, {
    ...options,
    pagesScanned: page,
  })
  if(typeof options.onBatch==='function') {
    for(let start=0;start<all.length;start+=250)await options.onBatch(all.slice(start,start+250))
  }
  await onProgress({progress:90,pagesScanned:page,candidates:count,platform:'whatsapp'})
  return {platform:'whatsapp',pagesScanned:page,candidateCount:count,
    candidates:options.collectInMemory===false?[]:all}
}
