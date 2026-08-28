import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { load } from 'cheerio'

const DEFAULT_MAX_PRODUCTS = 2000
const DEFAULT_MAX_PAGES = 2500
const MAX_SITEMAPS = 40
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 12000
const USER_AGENT = 'AtacadoShop-Migration/1.0 (+catalog migration requested by store owner)'

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
  if (redirects > 5) throw new Error('A loja redirecionou vezes demais.')

  return new Promise((resolve, reject) => {
    const request = requestImpl({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.hostname,
      headers: {
        'user-agent': USER_AGENT,
        accept: options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
        'accept-encoding': 'identity',
      },
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
        const body = Buffer.concat(chunks).toString('utf8')
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

export function detectPlatform(html) {
  const value = String(html || '').toLowerCase()
  if (value.includes('cdn.shopify.com') || value.includes('shopify.theme') || value.includes('shopify-section')) return 'shopify'
  if (value.includes('woocommerce') || value.includes('wc-block') || value.includes('wp-content/plugins/woocommerce')) return 'woocommerce'
  if (value.includes('nuvemshop') || value.includes('tiendanube')) return 'nuvemshop'
  if (value.includes('lojaintegrada') || value.includes('cdn.awsli.com.br')) return 'lojaintegrada'
  if (value.includes('tray.com.br') || value.includes('traycdn.com')) return 'tray'
  return 'generic'
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
  for (const item of asArray(value)) {
    const raw = typeof item === 'string' ? item : item && typeof item === 'object' ? item.url || item.contentUrl || item.thumbnailUrl || '' : ''
    if (!raw) continue
    result.push(baseUrl ? absoluteUrl(raw, baseUrl) : raw)
  }
  return uniqueStrings(result)
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
  if (products.length) return dedupeCandidates(products)

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
  const rawImage = $('meta[property="og:image"]').attr('content') || $('[itemprop="image"]').attr('src') ||
    $('.item.active img, .product_main img, .product-detail img, .product-page img').first().attr('src') || ''
  const image = absoluteUrl(rawImage, sourceUrl)
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
    images: image ? [image] : [],
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
    const resolved = sameOriginUrl($(element).attr('href'), origin)
    if (resolved) links.push(resolved)
  })
  return uniqueStrings(links)
}

async function collectShopify(rootUrl, request, maxProducts) {
  const origin = new URL(rootUrl).origin
  const candidates = []
  let pagesScanned = 0
  for (let page = 1; page <= 20 && candidates.length < maxProducts; page += 1) {
    const url = `${origin}/products.json?limit=250&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let payload
    try { payload = JSON.parse(response.body) } catch { break }
    const products = Array.isArray(payload?.products) ? payload.products : []
    if (!products.length) break
    for (const product of products) {
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
      candidates.push({
        source_url: `${origin}/products/${product.handle}`,
        external_id: String(product.id || ''),
        title: String(product.title || ''),
        description: String(product.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        sku: String(variants[0]?.sku || ''),
        category: String(product.product_type || ''),
        brand: String(product.vendor || ''),
        images: uniqueStrings(asArray(product.images).map((image) => image?.src || '')),
        variants,
        properties: options,
        price: Number.isFinite(variants[0]?.price) ? variants[0].price : null,
        price_text: variants[0]?.price != null ? String(variants[0].price) : '',
        currency: '',
        availability: '',
        source: 'shopify-products-json',
      })
      if (candidates.length >= maxProducts) break
    }
    if (products.length < 250) break
  }
  return { candidates: dedupeCandidates(candidates), pagesScanned }
}

async function collectWooCommerce(rootUrl, request, maxProducts) {
  const origin = new URL(rootUrl).origin
  const candidates = []
  let pagesScanned = 0
  for (let page = 1; page <= 30 && candidates.length < maxProducts; page += 1) {
    const url = `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`
    const response = await request(url, { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) break
    let products
    try { products = JSON.parse(response.body) } catch { break }
    if (!Array.isArray(products) || !products.length) break
    for (const product of products) {
      const minor = Number(product.prices?.currency_minor_unit ?? 2)
      const rawPrice = Number(product.prices?.price)
      const price = Number.isFinite(rawPrice) ? rawPrice / (10 ** minor) : null
      candidates.push({
        source_url: String(product.permalink || `${origin}/?p=${product.id}`),
        external_id: String(product.id || ''),
        title: String(product.name || ''),
        description: String(product.description || product.short_description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        sku: String(product.sku || ''),
        category: String(product.categories?.[0]?.name || ''),
        brand: '',
        images: uniqueStrings(asArray(product.images).map((image) => image?.src || image?.thumbnail || '')),
        variants: [],
        properties: asArray(product.attributes).map((attribute) => ({ name: String(attribute.name || ''), values: uniqueStrings(attribute.terms?.map((term) => term.name) || []) })),
        price,
        price_text: price == null ? '' : String(price),
        currency: String(product.prices?.currency_code || ''),
        availability: product.is_in_stock ? 'InStock' : 'OutOfStock',
        source: 'woocommerce-store-api',
      })
      if (candidates.length >= maxProducts) break
    }
    if (products.length < 100) break
  }
  return { candidates: dedupeCandidates(candidates), pagesScanned }
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

async function collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress) {
  const rootUrl = rootResponse.url
  const origin = new URL(rootUrl).origin
  const queued = new Set()
  const visited = new Set([rootUrl])
  const queue = []
  const enqueue = (input) => {
    const resolved = sameOriginUrl(input, origin)
    if (!resolved || visited.has(resolved) || queued.has(resolved) || visited.size + queued.size >= maxPages) return
    queued.add(resolved)
    queue.push(resolved)
  }
  for (const link of linksFromHtml(rootResponse.body, rootUrl)) enqueue(link)

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

  while (sitemapQueue.length && visitedSitemaps.size < MAX_SITEMAPS && visited.size + queued.size < maxPages) {
    const sitemapUrl = sitemapQueue.shift()
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue
    visitedSitemaps.add(sitemapUrl)
    try {
      const response = await request(sitemapUrl, { accept: 'application/xml,text/xml,text/plain' })
      pagesScanned += 1
      if (!response.ok) continue
      for (const location of extractSitemapLocations(response.body)) {
        const resolved = sameOriginUrl(location, origin)
        if (!resolved) continue
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(resolved) || /sitemap/i.test(new URL(resolved).pathname)) sitemapQueue.push(resolved)
        else enqueue(resolved)
        if (visited.size + queued.size >= maxPages) break
      }
    } catch { /* one broken sitemap must not abort the catalog */ }
  }

  const candidates = [...extractProductsFromHtml(rootResponse.body, rootUrl)]
  let processed = 0
  while (queue.length && visited.size < maxPages && candidates.length < maxProducts) {
    queue.sort((a, b) => productPathScore(b) - productPathScore(a))
    const batch = queue.splice(0, Math.min(12, queue.length))
    for (const url of batch) queued.delete(url)

    await mapLimit(batch, 4, async (url) => {
      if (visited.has(url) || candidates.length >= maxProducts) return
      visited.add(url)
      try {
        const response = await request(url)
        pagesScanned += 1
        if (!response.ok || !response.contentType.includes('html')) return
        const found = extractProductsFromHtml(response.body, response.url)
        for (const product of found) {
          if (candidates.length >= maxProducts) break
          candidates.push(product)
        }
        if (visited.size + queued.size < maxPages) {
          for (const link of linksFromHtml(response.body, response.url)) enqueue(link)
        }
      } catch { /* inaccessible pages are skipped */ }
      finally {
        processed += 1
        if (processed % 10 === 0 || !queue.length || candidates.length >= maxProducts) {
          const discoveryBase = Math.max(1, Math.min(maxPages, visited.size + queued.size))
          const progress = Math.min(90, 15 + Math.round((visited.size / discoveryBase) * 75))
          await onProgress({ progress, pagesScanned, candidates: candidates.length })
        }
      }
    })
  }

  return { candidates: dedupeCandidates(candidates).slice(0, maxProducts), pagesScanned }
}

export async function collectCatalog(sourceUrl, options = {}) {
  const request = options.request || safeRequest
  const maxProducts = Math.max(1, Math.min(5000, Number(options.maxProducts || process.env.SCANNER_MAX_PRODUCTS || DEFAULT_MAX_PRODUCTS)))
  const maxPages = Math.max(1, Math.min(6000, Number(options.maxPages || process.env.SCANNER_MAX_PAGES || DEFAULT_MAX_PAGES)))
  const onProgress = options.onProgress || (async () => {})

  await onProgress({ progress: 5, pagesScanned: 0, candidates: 0 })
  const rootResponse = await request(sourceUrl)
  if (!rootResponse.ok) throw new Error(`A loja respondeu HTTP ${rootResponse.status}.`)
  if (!rootResponse.contentType.includes('html')) throw new Error('A URL informada não parece ser uma página de loja.')

  const platform = detectPlatform(rootResponse.body)
  await onProgress({ progress: 10, pagesScanned: 1, candidates: 0, platform })

  if (platform === 'shopify') {
    try {
      const result = await collectShopify(rootResponse.url, request, maxProducts)
      if (result.candidates.length) return { platform, pagesScanned: result.pagesScanned + 1, candidates: result.candidates }
    } catch { /* generic fallback below */ }
  }

  if (platform === 'woocommerce') {
    try {
      const result = await collectWooCommerce(rootResponse.url, request, maxProducts)
      if (result.candidates.length) return { platform, pagesScanned: result.pagesScanned + 1, candidates: result.candidates }
    } catch { /* generic fallback below */ }
  }

  const result = await collectGeneric(rootResponse, request, maxProducts, maxPages, onProgress)
  return { platform, pagesScanned: result.pagesScanned, candidates: result.candidates }
}
