import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { load } from 'cheerio'
import { detectStorefrontPlatform, extractFacilZapRuntime, facilZapProducts, parseVestiContext, vestiProducts, isZapFacilCatalogPage } from './scanner-platforms.mjs'
import { collectDirectedSitemap, collectTrayPublic, parseVestiCompanyId, enrichVestiCandidate } from './scanner-platform-collectors.mjs'

// Produção não possui teto artificial de produtos/páginas. Limites só são usados quando
// explicitamente informados (testes, diagnóstico ou operação controlada).
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const SITEMAP_MAX_RESPONSE_BYTES = 64 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 12000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36'
const MAX_PRODUCT_IMAGES = 40

function blockedIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function blockedIpv6(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)
}

export function isPublicAddress(address) {
  const version = isIP(String(address || '').replace(/^\[|\]$/g, ''))
  if (version === 4) return !blockedIpv4(address)
  if (version === 6) return !blockedIpv6(address)
  return false
}

async function resolvePublicAddress(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  const publicRecord = records.find((record) => isPublicAddress(record.address))
  if (!publicRecord) throw new Error('O domínio informado não aponta para um endereço público permitido.')
  return publicRecord
}

export async function safeRequest(input, options = {}) {
  const url = input instanceof URL ? new URL(input) : new URL(String(input))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('O scanner aceita somente páginas http ou https.')
  if (url.username || url.password) throw new Error('URL com credenciais não é permitida.')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta personalizada não é permitida.')

  const resolved = await resolvePublicAddress(url.hostname)
  const requestImpl = url.protocol === 'https:' ? https.request : http.request
  const maxBytes = Number(options.maxBytes || MAX_RESPONSE_BYTES)
  const redirects = Number(options.redirects || 0)
  const method = String(options.method || 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(method)) throw new Error('Método HTTP não permitido pelo scanner.')
  const body = options.body == null ? null : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
  if (body && body.length > 64 * 1024) throw new Error('Corpo da requisição maior que o limite seguro do scanner.')
  if (redirects > 5) throw new Error('A loja redirecionou vezes demais.')

  return new Promise((resolve, reject) => {
    const headers = {
      'user-agent': USER_AGENT,
      accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
      'accept-encoding': 'identity',
      ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
    }
    if (body && !headers['content-length']) headers['content-length'] = String(body.length)
    const request = requestImpl({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      servername: url.hostname,
      headers,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address: resolved.address, family: resolved.family }])
        else callback(null, resolved.address, resolved.family)
      },
      timeout: Number(options.timeout || REQUEST_TIMEOUT_MS),
    }, async (response) => {
      const status = Number(response.statusCode || 0)
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume()
        try {
          const target = new URL(response.headers.location, url)
          resolve(await safeRequest(target, { ...options, redirects: redirects + 1 }))
        } catch (error) {
          reject(error)
        }
        return
      }

      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          request.destroy(new Error('Resposta maior que o limite seguro do scanner.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        let buffer = Buffer.concat(chunks)
        const gzip = String(response.headers['content-encoding'] || '').toLowerCase().includes('gzip') || url.pathname.toLowerCase().endsWith('.gz')
        if (gzip) {
          try {
            buffer = gunzipSync(buffer, { maxOutputLength: Number(options.maxOutputBytes || Math.max(maxBytes, SITEMAP_MAX_RESPONSE_BYTES)) })
          } catch {
            reject(new Error('Não foi possível descompactar o sitemap da loja.'))
            return
          }
        }
        const body = buffer.toString('utf8')
        resolve({
          status,
          ok: status >= 200 && status < 300,
          url: url.toString(),
          contentType: String(response.headers['content-type'] || '').toLowerCase(),
          headers: response.headers,
          body,
        })
      })
    })
    request.on('timeout', () => request.destroy(new Error('A página demorou demais para responder.')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function extractSitemapLocations(xml) {
  const locations = []
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi
  let match
  while ((match = pattern.exec(String(xml || '')))) {
    const value = decodeXml(match[1].trim())
    if (value) locations.push(value)
  }
  return locations
}

export function detectPlatform(html, sourceUrl = '') {
  return detectStorefrontPlatform(html, sourceUrl)
}


function facilZapJavascriptRedirect(html, currentUrl) {
  let host = ''
  try { host = new URL(currentUrl).hostname.toLowerCase() } catch { return '' }
  if (host !== 'facilzap.app.br' && !host.endsWith('.facilzap.app.br')) return ''
  const source = String(html || '')
  if (source.length > 4096) return ''
  const match = /(?:window\.)?location(?:\.href)?\s*=\s*['"](https?:\/\/[^'"]+)['"]/i.exec(source)
  if (!match) return ''
  try {
    const target = new URL(match[1])
    return ['http:', 'https:'].includes(target.protocol) ? target.toString() : ''
  } catch { return '' }
}

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function absoluteUrl(value, baseUrl) {
  try { return value ? new URL(String(value), baseUrl).toString() : '' } catch { return '' }
}

function imagesFrom(value, baseUrl = '') {
  const result = []
  const visited = new Set()
  const add = (raw) => {
    const value = baseUrl ? absoluteUrl(raw, baseUrl) : String(raw || '').trim()
    if (value && !result.includes(value)) result.push(value)
  }
  const visit = (item) => {
    if (item == null || result.length >= MAX_PRODUCT_IMAGES) return
    if (typeof item === 'string') {
      add(item)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (typeof item !== 'object' || visited.has(item)) return
    visited.add(item)
    for (const key of ['url', 'contentUrl', 'thumbnailUrl', 'src', 'imageUrl', 'image_url', 'original', 'large', 'full']) {
      if (typeof item[key] === 'string') add(item[key])
    }
    for (const key of ['image', 'images', 'media', 'gallery', 'thumbnail']) {
      if (item[key] != null) visit(item[key])
    }
  }
  visit(value)
  return uniqueStrings(result).slice(0, MAX_PRODUCT_IMAGES)
}

function bestSrcsetUrl(value, baseUrl) {
  const candidates = String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)
  if (!candidates.length) return ''
  return absoluteUrl(candidates.at(-1), baseUrl)
}

function pageGalleryImages($, sourceUrl) {
  const result = []
  const seen = new Set()
  const add = (raw) => {
    const value = absoluteUrl(raw, sourceUrl)
    if (!value || seen.has(value)) return
    seen.add(value)
    result.push(value)
  }
  const addNode = (node) => {
    if (result.length >= MAX_PRODUCT_IMAGES) return
    const tag = String(node[0]?.tagName || '').toLowerCase()
    if (tag === 'meta') add(node.attr('content'))
    for (const attribute of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-image-url', 'data-zoom-image', 'data-large-image', 'data-full', 'data-full-image']) {
      add(node.attr(attribute))
    }
    for (const attribute of ['srcset', 'data-srcset']) add(bestSrcsetUrl(node.attr(attribute), sourceUrl))
    if (tag === 'a') {
      const href = node.attr('href')
      if (/\.(?:avif|webp|jpe?g|png|gif)(?:$|[?#])/i.test(String(href || ''))) add(href)
    }
  }

  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[itemprop="image"]').each((_index, element) => addNode($(element)))
  const selectors = [
    '[itemprop="image"]',
    '.product-gallery img', '.product-gallery a',
    '.product-images img', '.product-images a',
    '.product-image img', '.product-image a',
    '.product-media img', '.product-media a',
    '.product-thumbnails img', '.product-thumbnails a',
    '.product-thumbs img', '.product-thumbs a',
    '.produto-imagens img', '.produto-imagens a',
    '.produto-imagem img', '.produto-imagem a',
    '.produto-thumbs img', '.produto-thumbs a',
    '[data-product-gallery] img', '[data-product-gallery] a',
    '[data-product-images] img', '[data-product-images] a',
    '.gallery img', '.gallery a',
    '.swiper-slide img', '.slick-slide img', '.carousel-item img',
    '.item.active img', '.product_main img', '.product-detail img', '.product-page img',
  ]
  $(selectors.join(',')).each((_index, element) => {
    if (result.length < MAX_PRODUCT_IMAGES) addNode($(element))
  })
  return result.slice(0, MAX_PRODUCT_IMAGES)
}

function offerInfo(offers) {
  const list = asArray(offers).filter((item) => item && typeof item === 'object')
  const first = list[0] || {}
  const price = first.price ?? first.lowPrice ?? first.highPrice ?? ''
  return {
    price: price === '' ? null : Number(price),
    price_text: price === '' ? '' : String(price),
    currency: String(first.priceCurrency || ''),
    availability: String(first.availability || ''),
  }
}

function propertiesFromJsonLd(node) {
  const properties = []
  if (node.color) properties.push({ name: 'Cor', value: String(node.color) })
  if (node.size) properties.push({ name: 'Tamanho', value: String(node.size) })
  if (node.material) properties.push({ name: 'Material', value: String(node.material) })
  for (const property of asArray(node.additionalProperty)) {
    if (property?.name && property?.value != null) properties.push({ name: String(property.name), value: String(property.value) })
  }
  return properties
}

function productFromJsonLd(node, sourceUrl) {
  const offer = offerInfo(node.offers)
  const variants = asArray(node.hasVariant).filter(Boolean).map((variant) => ({
    name: String(variant.name || ''),
    sku: String(variant.sku || ''),
    color: String(variant.color || ''),
    size: String(variant.size || ''),
    images: imagesFrom(variant.image, sourceUrl),
    ...offerInfo(variant.offers),
    properties: propertiesFromJsonLd(variant),
  }))
  return {
    source_url: sourceUrl,
    external_id: String(node.productID || node.sku || ''),
    title: String(node.name || '').trim(),
    description: String(node.description || '').trim(),
    sku: String(node.sku || '').trim(),
    category: String(node.category || '').trim(),
    brand: typeof node.brand === 'string' ? node.brand : String(node.brand?.name || ''),
    images: imagesFrom(node.image, sourceUrl),
    variants,
    properties: propertiesFromJsonLd(node),
    ...offer,
    source: 'jsonld',
  }
}

function walkJsonLd(value, products, sourceUrl, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, products, sourceUrl, seen)
    return
  }
  const types = asArray(value['@type']).map((item) => String(item).toLowerCase())
  if (types.includes('product') || types.includes('productgroup')) {
    const product = productFromJsonLd(value, sourceUrl)
    if (product.title) products.push(product)
    return
  }
  if (Array.isArray(value['@graph'])) walkJsonLd(value['@graph'], products, sourceUrl, seen)
  for (const [key, child] of Object.entries(value)) {
    if (key === '@graph') continue
    if (child && typeof child === 'object') walkJsonLd(child, products, sourceUrl, seen)
  }
}

function selectOptions($) {
  const properties = []
  $('select').each((_index, element) => {
    const select = $(element)
    const label = select.attr('aria-label') || select.attr('name') || select.attr('id') || ''
    const name = String(label).replace(/[-_]/g, ' ').trim()
    if (!name) return
    const values = uniqueStrings(select.find('option').map((_i, option) => $(option).text().trim()).get())
      .filter((value) => !/^(selecione|escolha|select|choose)$/i.test(value))
      .slice(0, 50)
    if (values.length) properties.push({ name, values })
  })
  return properties.slice(0, 10)
}

function tableValue($, labels) {
  const wanted = labels.map((value) => value.toLowerCase())
  let found = ''
  $('tr').each((_index, row) => {
    if (found) return
    const cells = $(row).find('th,td')
    if (cells.length < 2) return
    const label = $(cells[0]).text().trim().toLowerCase().replace(/[:：]$/, '')
    if (wanted.includes(label)) found = $(cells[1]).text().trim()
  })
  return found
}

function inferCurrency(priceText) {
  const value = String(priceText || '')
  if (/R\$/i.test(value)) return 'BRL'
  if (value.includes('£')) return 'GBP'
  if (value.includes('€')) return 'EUR'
  if (value.includes('$')) return 'USD'
  return ''
}

export function extractProductsFromHtml(html, sourceUrl) {
  const $ = load(String(html || ''))
  const products = []
  $('script[type="application/ld+json"]').each((_index, element) => {
    const text = $(element).text().trim()
    if (!text) return
    try { walkJsonLd(JSON.parse(text), products, sourceUrl) } catch { /* invalid JSON-LD is ignored */ }
  })
  const galleryImages = pageGalleryImages($, sourceUrl)
  if (products.length) {
    return dedupeCandidates(products.map((product) => ({
      ...product,
      images: uniqueStrings([...(product.images || []), ...galleryImages]).slice(0, MAX_PRODUCT_IMAGES),
    })))
  }

  const ogType = $('meta[property="og:type"]').attr('content') || ''
  const priceText = $('meta[property="product:price:amount"]').attr('content') ||
    $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').first().text().trim() ||
    $('.product_main .price_color, .product-price, .price, [data-price]').first().text().trim()
  const productSignal = /product/i.test(ogType) || Boolean(priceText) || $('[itemtype*="schema.org/Product"], [data-product-id], [data-product], .product_main, .product-detail, .product-page').length > 0
  if (!productSignal) return []

  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || $('title').text().trim()
  if (!title) return []
  const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') ||
    $('#product_description').next('p').text().trim() || $('.product-description, .description').first().text().trim() || ''
  const explicitCurrency = $('meta[property="product:price:currency"]').attr('content') || ''
  const numericPrice = Number(String(priceText).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
  const breadcrumb = $('.breadcrumb a').map((_index, element) => $(element).text().trim()).get().filter(Boolean)
  const category = $('meta[property="product:category"]').attr('content') || breadcrumb[breadcrumb.length - 1] || tableValue($, ['product type', 'categoria', 'category']) || ''
  const sku = $('[itemprop="sku"]').attr('content') || $('[itemprop="sku"]').first().text().trim() || tableValue($, ['sku', 'referência', 'referencia', 'reference', 'código', 'codigo', 'upc']) || ''
  const availability = $('meta[property="product:availability"]').attr('content') || $('.availability').first().text().trim() || tableValue($, ['availability', 'disponibilidade']) || ''
  return [{
    source_url: sourceUrl,
    external_id: '',
    title,
    description,
    sku,
    category,
    brand: '',
    images: galleryImages,
    variants: [],
    properties: selectOptions($),
    price: Number.isFinite(numericPrice) ? numericPrice : null,
    price_text: String(priceText || ''),
    currency: explicitCurrency || inferCurrency(priceText),
    availability,
    source: 'html',
  }]
}

function dedupeCandidates(products) {
  const seen = new Set()
  return products.filter((product) => {
    const key = `${product.source_url}|${product.external_id}|${product.title}`.toLowerCase()
    if (!product.title || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameOriginUrl(input, origin) {
  try {
    const url = new URL(input, origin)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$|ref$|referrer$)/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return url.toString()
  } catch {
    return null
  }
}

function productPathScore(input) {
  try {
    const path = new URL(input).pathname.toLowerCase()
    let score = 0
    if (/\/(produto|produtos|product|products|item|p)\//.test(path)) score += 5
    if (/[-/]p(?:[-/.]|$)/.test(path)) score += 2
    if (/sku|produto|product/.test(path)) score += 1
    if (/\/(blog|pages?|contato|contact|politica|policy|collections?|categorias?)\//.test(path)) score -= 3
    return score
  } catch {
    return -10
  }
}

function linksFromHtml(html, baseUrl) {
  const $ = load(String(html || ''))
  const origin = new URL(baseUrl).origin
  const links = []
  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')
    const absolute = absoluteUrl(href, baseUrl)
    const resolved = absolute ? sameOriginUrl(absolute, origin) : null
    if (resolved) links.push(resolved)
  })
  return uniqueStrings(links)
}

function configuredLimit(value) {
  if (value == null || value === '') return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY
}

function candidateKey(product) {
  return `${product?.source_url || ''}|${product?.external_id || ''}|${product?.title || ''}`.toLowerCase()
}

function createCandidateSink(options, maxProducts) {
  const collectInMemory = options.collectInMemory !== false
  const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null
  const candidates = []
  const seen = new Set()
  let count = 0
  let chain = Promise.resolve()

  const push = (items) => {
    chain = chain.then(async () => {
      const accepted = []
      for (const product of Array.isArray(items) ? items : []) {
        if (count >= maxProducts) break
        const key = candidateKey(product)
        if (!product?.title || seen.has(key)) continue
        seen.add(key)
        count += 1
        accepted.push(product)
      }
      if (!accepted.length) return
      if (collectInMemory) candidates.push(...accepted)
      if (onBatch) await onBatch(accepted, { candidateCount: count })
    })
    return chain
  }

  return {
    push,
    flush: () => chain,
    get count() { return count },
    get candidates() { return candidates },
  }
}

function shopifyProduct(origin, product) {
  const options = asArray(product.options).map((option) => ({ name: String(option.name || ''), values: uniqueStrings(option.values || []) }))
  const variants = asArray(product.variants).map((variant) => ({
    external_id: String(variant.id || ''),
    title: String(variant.title || ''),
    sku: String(variant.sku || ''),
    price: Number(variant.price),
    option1: String(variant.option1 || ''),
    option2: String(variant.option2 || ''),
    option3: String(variant.option3 || ''),
    available: variant.available !== false,
  }))
  return {
    source_url: `${origin}/products/${product.handle}`,
    external_id: String(product.id || ''),
    title: String(product.title || ''),
    description: String(product.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sku: String(variants[0]?.sku || ''),
    category: String(product.product_type || ''),
    brand: String(product.vendor || ''),
    images: uniqueStrings(asArray(product.images).map((image) => image?.src || '')).slice(0, MAX_PRODUCT_IMAGES),
    variants,
    properties: options,
    price: Number.isFinite(variants[0]?.price) ? variants[0].price : null,
    price_text: variants[0]?.price != null ? String(variants[0].price) : '',
    currency: '',
    availability: '',
    source: 'shopify-products-json',
  }
}

async function collectShopify(rootUrl, request, maxProducts, sink, onProgress) {
  const origin = new URL(rootUrl).origin
  const pageSignatures = new Set()
  let pagesScanned = 0

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const url = `${origin}/products.json?limit=250&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let payload
    try { payload = JSON.parse(response.body) } catch { break }
    const products = Array.isArray(payload?.products) ? payload.products : []
    if (!products.length) break

    const signature = `${products[0]?.id || products[0]?.handle || ''}|${products.at(-1)?.id || products.at(-1)?.handle || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    await sink.push(products.map((product) => shopifyProduct(origin, product)))
    if (page % 5 === 0 || products.length < 250 || sink.count >= maxProducts) {
      await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count })
    }
    if (products.length < 250) break
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

function wooProduct(origin, product) {
  const minor = Number(product.prices?.currency_minor_unit ?? 2)
  const rawPrice = Number(product.prices?.price)
  const price = Number.isFinite(rawPrice) ? rawPrice / (10 ** minor) : null
  return {
    source_url: String(product.permalink || `${origin}/?p=${product.id}`),
    external_id: String(product.id || ''),
    title: String(product.name || ''),
    description: String(product.description || product.short_description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sku: String(product.sku || ''),
    category: String(product.categories?.[0]?.name || ''),
    brand: '',
    images: uniqueStrings(asArray(product.images).map((image) => image?.src || image?.thumbnail || '')).slice(0, MAX_PRODUCT_IMAGES),
    variants: [],
    properties: asArray(product.attributes).map((attribute) => ({ name: String(attribute.name || ''), values: uniqueStrings(attribute.terms?.map((term) => term.name) || []) })),
    price,
    price_text: price == null ? '' : String(price),
    currency: String(product.prices?.currency_code || ''),
    availability: product.is_in_stock ? 'InStock' : 'OutOfStock',
    source: 'woocommerce-store-api',
  }
}

async function collectWooCommerce(rootUrl, request, maxProducts, sink, onProgress) {
  const origin = new URL(rootUrl).origin
  const pageSignatures = new Set()
  let pagesScanned = 0

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const url = `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let products
    try { products = JSON.parse(response.body) } catch { break }
    if (!Array.isArray(products) || !products.length) break

    const signature = `${products[0]?.id || ''}|${products.at(-1)?.id || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    await sink.push(products.map((product) => wooProduct(origin, product)))
    if (page % 10 === 0 || products.length < 100 || sink.count >= maxProducts) {
      await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count })
    }
    if (products.length < 100) break
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

function variantMatchKey(variant) {
  const sku = String(variant?.sku || '').trim().toLowerCase()
  if (sku) return `sku:${sku}`
  const id = String(variant?.external_id || '').trim().toLowerCase()
  if (id) return `id:${id}`
  const title = String(variant?.title || variant?.name || '').trim().toLowerCase()
  const color = String(variant?.color || '').trim().toLowerCase()
  const size = String(variant?.size || '').trim().toLowerCase()
  return `fallback:${title}|${color}|${size}`
}

function mergeDetailIntoCandidate(candidate, detail) {
  if (!detail) return candidate
  const images = uniqueStrings([...(candidate.images || []), ...(detail.images || [])]).slice(0, MAX_PRODUCT_IMAGES)
  const detailVariants = new Map(asArray(detail.variants).map((variant) => [variantMatchKey(variant), variant]))
  const variants = asArray(candidate.variants).map((variant) => {
    const match = detailVariants.get(variantMatchKey(variant))
    if (!match) return variant
    const variantImages = uniqueStrings([
      ...imagesFrom(variant.images || variant.image, candidate.source_url),
      ...imagesFrom(match.images || match.image, detail.source_url || candidate.source_url),
    ]).slice(0, 8)
    return variantImages.length ? { ...variant, images: variantImages } : variant
  })
  return { ...candidate, images, variants }
}

async function collectFacilZap(rootResponse, request, maxProducts, sink, onProgress) {
  const runtime = extractFacilZapRuntime(rootResponse.body)
  if (!runtime?.urlCarregarProdutosTemplate) throw new Error('A vitrine FácilZap não expôs o contrato público de paginação esperado.')

  const seenPages = new Set()
  let pagesScanned = 1
  let page = 1
  while (sink.count < maxProducts) {
    const category = Number(runtime.categoria || 0) > 0 ? String(runtime.categoria) : 'todas'
    const endpoint = String(runtime.urlCarregarProdutosTemplate)
      .replace('{PAGE}', String(page))
      .replace('{CATEGORY}', category)
    const url = new URL(endpoint, rootResponse.url)
    if (runtime.searchId) url.searchParams.set('search_id', String(runtime.searchId))
    url.searchParams.set('mobile', '0')
    if (runtime.idPerfilCompra) url.searchParams.set('perfil_compra', String(runtime.idPerfilCompra))
    if (runtime.variacoes) url.searchParams.set('variacoes', String(runtime.variacoes))

    const response = await request(url.toString(), {
      method: 'POST',
      accept: 'application/json,text/plain,*/*',
      headers: { 'content-type': 'application/json' },
      body: { pagina_especifica: runtime.paginaEspecifica || '' },
    })
    pagesScanned += 1
    if (!response.ok) throw new Error(`A paginação pública do FácilZap respondeu HTTP ${response.status}.`)

    let payload
    try { payload = JSON.parse(response.body || '{}') } catch { throw new Error('O FácilZap retornou uma página de catálogo em formato inesperado.') }
    const mapped = facilZapProducts(payload, rootResponse.url)
    if (mapped.end) break
    const signature = mapped.products.map((product) => product.external_id || product.source_url || product.title).join('|')
    if (!signature || seenPages.has(signature)) break
    seenPages.add(signature)

    const enriched = await mapLimit(mapped.products, 6, async (candidate) => {
      const detailUrl = String(candidate?.source_url || '').trim()
      if (!detailUrl || detailUrl === rootResponse.url) return candidate
      try {
        const detailResponse = await request(detailUrl, { accept: 'text/html,application/xhtml+xml' })
        pagesScanned += 1
        if (!detailResponse.ok || !detailResponse.contentType.includes('html')) return candidate
        const detailProducts = extractProductsFromHtml(detailResponse.body, detailResponse.url)
        const normalizedTitle = String(candidate.title || '').trim().toLowerCase()
        const detail = detailProducts.find((product) => String(product.sku || '').trim() && String(product.sku || '').trim() === String(candidate.sku || '').trim()) ||
          detailProducts.find((product) => String(product.title || '').trim().toLowerCase() === normalizedTitle) || detailProducts[0]
        return mergeDetailIntoCandidate(candidate, detail)
      } catch {
        return candidate
      }
    })

    await sink.push(enriched)
    await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count, platform: 'facilzap' })
    page += 1
  }
  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

async function collectVesti(rootResponse, request, maxProducts, sink, onProgress) {
  const context = parseVestiContext(rootResponse.url, rootResponse.body)
  if (!context) throw new Error('Não foi possível identificar loja e catálogo Vesti pela URL pública.')
  const companyId = parseVestiCompanyId(rootResponse.body)
  const pageSignatures = new Set()
  let pagesScanned = 1

  for (let page = 1; sink.count < maxProducts; page += 1) {
    const endpoint = new URL(`https://apivesti.vesti.mobi/appmarca/v2/catalogue/${encodeURIComponent(context.catalogId)}/company/${encodeURIComponent(context.schemeUrl)}/`)
    endpoint.searchParams.set('page', String(page))
    endpoint.searchParams.set('perpage', '60')
    endpoint.searchParams.set('with_categories', 'true')
    endpoint.searchParams.set('with_colors', 'true')
    endpoint.searchParams.set('with_product_colors', 'true')
    endpoint.searchParams.set('with_sizes', 'true')
    endpoint.searchParams.set('with_brands', 'true')
    endpoint.searchParams.set('with_prices', 'true')
    endpoint.searchParams.set('with_tags', '1')

    const response = await request(endpoint.toString(), { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) throw new Error(`A API pública do Vesti respondeu HTTP ${response.status}.`)
    let payload
    try { payload = JSON.parse(response.body) } catch { throw new Error('O Vesti retornou catálogo em formato inesperado.') }
    const listed = Array.isArray(payload?.products) ? payload.products : []
    const products = vestiProducts(payload, context)
    if (!products.length) break
    const signature = `${products[0]?.external_id || ''}|${products.at(-1)?.external_id || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)

    let enriched = products
    if (companyId) {
      enriched = await mapLimit(products, 6, async (candidate, index) => {
        const raw = listed[index]
        const productId = candidate.external_id || raw?.id
        if (!productId) return candidate
        const detailUrl = new URL(`https://apivesti.vesti.mobi/appmarca/v1/products/company/${encodeURIComponent(companyId)}/product/${encodeURIComponent(productId)}/showcase`)
        detailUrl.searchParams.set('cid', context.catalogId)
        detailUrl.searchParams.set('reseller_id', 'null')
        try {
          const detailResponse = await request(detailUrl.toString(), { accept: 'application/json' })
          pagesScanned += 1
          if (!detailResponse.ok) return candidate
          const detail = JSON.parse(detailResponse.body)
          return enrichVestiCandidate(candidate, detail)
        } catch {
          return candidate
        }
      })
    }

    await sink.push(enriched)
    await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count, platform: 'vesti' })
    if (!payload?.links?.next) break
  }
  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

async function mapLimit(values, limit, mapper) {
  const result = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= values.length) return
      result[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return result
}

async function collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress, sink) {
  const rootUrl = rootResponse.url
  const origin = new URL(rootUrl).origin
  const queued = new Set()
  const visited = new Set([rootUrl])
  const highQueue = []
  const normalQueue = []

  const enqueue = (input) => {
    const resolved = sameOriginUrl(input, origin)
    if (!resolved || visited.has(resolved) || queued.has(resolved) || visited.size + queued.size >= maxPages) return
    queued.add(resolved)
    if (productPathScore(resolved) > 0) highQueue.push(resolved)
    else normalQueue.push(resolved)
  }
  const nextBatch = () => {
    const batch = []
    while (batch.length < 12 && (highQueue.length || normalQueue.length)) {
      const url = highQueue.length ? highQueue.shift() : normalQueue.shift()
      if (!url) continue
      queued.delete(url)
      batch.push(url)
    }
    return batch
  }

  for (const link of linksFromHtml(rootResponse.body, rootUrl)) enqueue(link)
  await sink.push(extractProductsFromHtml(rootResponse.body, rootUrl))

  const sitemapQueue = [`${origin}/sitemap.xml`]
  const visitedSitemaps = new Set()
  let pagesScanned = 1

  try {
    const robots = await request(`${origin}/robots.txt`, { accept: 'text/plain' })
    pagesScanned += 1
    if (robots.ok) {
      for (const line of robots.body.split(/\r?\n/)) {
        const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
        if (match) sitemapQueue.push(match[1])
      }
    }
  } catch { /* sitemap.xml fallback remains */ }

  while (sitemapQueue.length && visited.size + queued.size < maxPages && sink.count < maxProducts) {
    const sitemapUrl = sitemapQueue.shift()
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue
    visitedSitemaps.add(sitemapUrl)
    try {
      const response = await request(sitemapUrl, {
        accept: 'application/xml,text/xml,text/plain,application/gzip',
        maxBytes: SITEMAP_MAX_RESPONSE_BYTES,
        maxOutputBytes: SITEMAP_MAX_RESPONSE_BYTES,
      })
      pagesScanned += 1
      if (!response.ok) continue
      for (const location of extractSitemapLocations(response.body)) {
        const resolved = sameOriginUrl(location, origin)
        if (!resolved) continue
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(resolved) || /sitemap/i.test(new URL(resolved).pathname)) {
          if (!visitedSitemaps.has(resolved)) sitemapQueue.push(resolved)
        } else {
          enqueue(resolved)
        }
        if (visited.size + queued.size >= maxPages) break
      }
    } catch { /* one broken sitemap must not abort the catalog */ }
  }

  let processed = 0
  while ((highQueue.length || normalQueue.length) && visited.size < maxPages && sink.count < maxProducts) {
    const batch = nextBatch()
    await mapLimit(batch, 4, async (url) => {
      if (visited.has(url) || sink.count >= maxProducts) return
      visited.add(url)
      try {
        const response = await request(url)
        pagesScanned += 1
        if (!response.ok || !response.contentType.includes('html')) return
        await sink.push(extractProductsFromHtml(response.body, response.url))
        if (visited.size + queued.size < maxPages && sink.count < maxProducts) {
          for (const link of linksFromHtml(response.body, response.url)) enqueue(link)
        }
      } catch { /* inaccessible pages are skipped */ }
      finally {
        processed += 1
        if (processed % 25 === 0 || (!highQueue.length && !normalQueue.length) || sink.count >= maxProducts) {
          const discovered = Math.max(1, visited.size + queued.size)
          const progress = Math.min(90, 15 + Math.round((visited.size / discovered) * 75))
          await onProgress({ progress, pagesScanned, candidates: sink.count })
        }
      }
    })
  }

  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

export async function collectCatalog(sourceUrl, options = {}) {
  const request = options.request || safeRequest
  const maxProducts = configuredLimit(options.maxProducts ?? process.env.SCANNER_MAX_PRODUCTS)
  const maxPages = configuredLimit(options.maxPages ?? process.env.SCANNER_MAX_PAGES)
  const onProgress = options.onProgress || (async () => {})
  const sink = createCandidateSink(options, maxProducts)

  await onProgress({ progress: 5, pagesScanned: 0, candidates: 0 })
  let rootResponse = await request(sourceUrl)
  if (!rootResponse.ok) throw new Error(`A loja respondeu HTTP ${rootResponse.status}.`)
  if (!rootResponse.contentType.includes('html')) throw new Error('A URL informada não parece ser uma página de loja.')

  // FácilZap usa um redirect por JavaScript quando a loja possui domínio próprio.
  // Seguimos somente esse formato explícito vindo de facilzap.app.br; a nova URL ainda
  // passa integralmente pelo safeRequest/SSRF antes de ser lida.
  const jsRedirect = facilZapJavascriptRedirect(rootResponse.body, rootResponse.url)
  if (jsRedirect) {
    const redirected = await request(jsRedirect)
    if (!redirected.ok) throw new Error(`O domínio próprio da loja respondeu HTTP ${redirected.status}.`)
    if (!redirected.contentType.includes('html')) throw new Error('O domínio próprio do FácilZap não retornou uma vitrine HTML.')
    rootResponse = redirected
  }

  const platform = detectPlatform(rootResponse.body, rootResponse.url)
  await onProgress({ progress: 10, pagesScanned: 1, candidates: 0, platform })

  if (platform === 'facilzap') {
    try {
      const result = await collectFacilZap(rootResponse, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // A vitrine muda com frequência; o crawler genérico continua como fallback seguro.
    }
  }

  if (platform === 'vesti') {
    try {
      const result = await collectVesti(rootResponse, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // Mantém fallback genérico para URLs Vesti legadas.
    }
  }

  if (platform === 'zapfacil' && !isZapFacilCatalogPage(rootResponse.body)) {
    throw new Error('Esta URL do ZapFácil não expõe uma vitrine pública de produtos. Informe o link público da loja/catálogo, não o site da ferramenta.')
  }

  if (platform === 'nuvemshop' || platform === 'lojaintegrada') {
    try {
      const result = await collectDirectedSitemap({
        rootResponse,
        platform,
        request,
        maxProducts,
        maxPages,
        sink,
        onProgress,
        extractSitemapLocations,
        extractProductsFromHtml,
      })
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // Sites legados sem sitemap de produto continuam pelo crawler genérico.
    }
  }

  if (platform === 'tray') {
    try {
      const result = await collectTrayPublic({ rootResponse, request, maxProducts, sink, onProgress })
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
    } catch (error) {
      if (options.strictPlatformAdapters) throw error
      // Algumas lojas Tray restringem a API pública; nesses casos há fallback genérico.
    }
  }

  if (platform === 'shopify') {
    try {
      const result = await collectShopify(rootResponse.url, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned + 1, candidateCount: sink.count, candidates: sink.candidates }
    } catch { /* generic fallback below; already collected batches remain deduplicated */ }
  }

  if (platform === 'woocommerce') {
    try {
      const result = await collectWooCommerce(rootResponse.url, request, maxProducts, sink, onProgress)
      if (result.candidateCount) return { platform, pagesScanned: result.pagesScanned + 1, candidateCount: sink.count, candidates: sink.candidates }
    } catch { /* generic fallback below */ }
  }

  const result = await collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress, sink)
  return { platform, pagesScanned: result.pagesScanned, candidateCount: sink.count, candidates: sink.candidates }
}
