function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}

function text(value) {
  return String(value ?? '').trim()
}

function unique(values) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))]
}

function numberValue(value) {
  if (value == null || value === '') return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function preferredMediaUrls(value) {
  const items = asArray(value)
  return unique(items.map((item) => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    return item.normal?.url || item.zoom?.url || item.https || item.url || item.src || item.fallback || ''
  }))
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

function isXmlUrl(value) {
  try {
    const path = new URL(value).pathname.toLowerCase()
    return path.endsWith('.xml') || path.endsWith('.xml.gz') || path.includes('sitemap')
  } catch {
    return false
  }
}

function sameOrigin(value, origin) {
  try {
    const url = new URL(value, origin)
    return url.origin === origin ? url.toString() : null
  } catch {
    return null
  }
}

function nuvemshopProductUrl(value) {
  try {
    const path = new URL(value).pathname.replace(/\/+$/, '')
    return /\/(?:produtos|productos)\/[^/]+$/i.test(path)
  } catch {
    return false
  }
}

function lojaIntegradaProductSitemap(value) {
  try {
    return /\/sitemap\/product-[^/]*\.xml(?:\.gz)?$/i.test(new URL(value).pathname)
  } catch {
    return false
  }
}

export async function collectDirectedSitemap({
  rootResponse,
  platform,
  request,
  maxProducts,
  maxPages,
  sink,
  onProgress,
  extractSitemapLocations,
  extractProductsFromHtml,
}) {
  const origin = new URL(rootResponse.url).origin
  const sitemapQueue = [`${origin}/sitemap.xml`]
  const visitedSitemaps = new Set()
  const productUrls = new Set()
  let pagesScanned = 1
  const finitePageLimit = Number.isFinite(maxPages) ? maxPages : Number.POSITIVE_INFINITY

  while (sitemapQueue.length && productUrls.size < maxProducts && pagesScanned < finitePageLimit) {
    const sitemapUrl = sitemapQueue.shift()
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue
    visitedSitemaps.add(sitemapUrl)
    let response
    try {
      response = await request(sitemapUrl, {
        accept: 'application/xml,text/xml,text/plain,application/gzip',
        maxBytes: 64 * 1024 * 1024,
        maxOutputBytes: 64 * 1024 * 1024,
      })
    } catch {
      continue
    }
    pagesScanned += 1
    if (!response.ok) continue

    for (const rawLocation of extractSitemapLocations(response.body)) {
      const location = sameOrigin(rawLocation, origin)
      if (!location) continue
      if (isXmlUrl(location)) {
        if (platform === 'lojaintegrada' && !lojaIntegradaProductSitemap(location)) continue
        if (!visitedSitemaps.has(location)) sitemapQueue.push(location)
        continue
      }

      const isProduct = platform === 'nuvemshop'
        ? nuvemshopProductUrl(location)
        : platform === 'lojaintegrada'
          ? visitedSitemaps.has(sitemapUrl) && lojaIntegradaProductSitemap(sitemapUrl)
          : false
      if (isProduct) productUrls.add(location)
      if (productUrls.size >= maxProducts) break
    }
  }

  if (!productUrls.size) throw new Error(`O sitemap público da plataforma ${platform} não expôs URLs de produtos.`)
  const urls = [...productUrls].slice(0, Number.isFinite(maxProducts) ? maxProducts : undefined)
  let processed = 0
  await mapLimit(urls, 6, async (url) => {
    if (sink.count >= maxProducts) return
    try {
      const response = await request(url)
      pagesScanned += 1
      if (!response.ok || !response.contentType.includes('html')) return
      await sink.push(extractProductsFromHtml(response.body, response.url))
    } catch {
      // Uma página removida entre a leitura do sitemap e a importação não invalida o catálogo inteiro.
    } finally {
      processed += 1
      if (processed % 20 === 0 || processed === urls.length) {
        await onProgress({
          progress: Math.min(90, 15 + Math.round((processed / Math.max(1, urls.length)) * 75)),
          pagesScanned,
          candidates: sink.count,
          platform,
        })
      }
    }
  })
  await sink.flush()
  if (!sink.count) throw new Error(`Os produtos listados no sitemap de ${platform} não puderam ser interpretados.`)
  return { candidateCount: sink.count, pagesScanned, discoveredProducts: productUrls.size }
}

function trayVariant(variant) {
  const skuProperties = asArray(variant?.Sku).filter((item) => item?.type && item?.value)
  const color = text(skuProperties.find((item) => /cor|color/i.test(item.type))?.value)
  const size = text(skuProperties.find((item) => /tamanho|size|tam/i.test(item.type))?.value)
  const promotional = numberValue(variant?.promotional_price)
  const regular = numberValue(variant?.price)
  return {
    external_id: text(variant?.id),
    title: skuProperties.map((item) => `${item.type}: ${item.value}`).join(' / '),
    sku: text(variant?.reference ?? variant?.model ?? variant?.ean),
    color,
    size,
    price: promotional && promotional > 0 ? promotional : regular,
    available: variant?.available === '0' ? false : Number(variant?.stock ?? 1) !== 0,
    properties: skuProperties.map((item) => ({ name: text(item.type), value: text(item.value) })),
  }
}

function trayProduct(origin, product, variantsByProduct) {
  const variants = (variantsByProduct.get(text(product.id)) || []).map(trayVariant)
  const propertiesByName = new Map()
  for (const variant of variants) {
    for (const property of variant.properties || []) {
      if (!propertiesByName.has(property.name)) propertiesByName.set(property.name, new Set())
      propertiesByName.get(property.name).add(property.value)
    }
  }
  const properties = [...propertiesByName].map(([name, values]) => ({ name, values: [...values] }))
  const promotional = numberValue(product.promotional_price)
  const regular = numberValue(product.price)
  const url = product.url?.https || product.url?.http || (product.slug ? `${origin}/${product.slug}` : origin)
  return {
    source_url: url,
    external_id: text(product.id),
    title: text(product.name),
    description: text(product.description ?? product.description_small ?? product.metatag?.description),
    sku: text(product.reference ?? product.model ?? product.ean),
    category: text(product.category_name ?? product.category_id),
    brand: text(product.brand),
    images: preferredMediaUrls(product.ProductImage),
    variants,
    properties,
    price: promotional && promotional > 0 ? promotional : regular,
    price_text: text(promotional && promotional > 0 ? promotional : regular),
    currency: 'BRL',
    availability: product.available === '0' || product.available_for_purchase === '0' ? 'OutOfStock' : 'InStock',
    source: 'tray-public-web-api',
  }
}

async function fetchTrayPages(origin, request, resource, key, maxItems) {
  const items = []
  const signatures = new Set()
  let pagesScanned = 0
  for (let page = 1; items.length < maxItems; page += 1) {
    const endpoint = new URL(`/web_api/${resource}`, origin)
    endpoint.searchParams.set('limit', '50')
    endpoint.searchParams.set('page', String(page))
    const response = await request(endpoint.toString(), { accept: 'application/json' })
    pagesScanned += 1
    if (!response.ok) throw new Error(`A API pública da Tray respondeu HTTP ${response.status} em ${resource}.`)
    let payload
    try { payload = JSON.parse(response.body) } catch { throw new Error(`A Tray retornou ${resource} em formato inesperado.`) }
    const wrapped = Array.isArray(payload?.[key]) ? payload[key] : []
    const pageItems = wrapped.map((item) => item?.[key.slice(0, -1)] || item?.Product || item?.Variant || item).filter(Boolean)
    if (!pageItems.length) break
    const signature = `${pageItems[0]?.id || ''}|${pageItems.at(-1)?.id || ''}|${pageItems.length}`
    if (signatures.has(signature)) break
    signatures.add(signature)
    items.push(...pageItems)
    const total = Number(payload?.paging?.total || 0)
    if ((total && items.length >= total) || pageItems.length < 50) break
  }
  return { items: items.slice(0, Number.isFinite(maxItems) ? maxItems : undefined), pagesScanned }
}

export async function collectTrayPublic({ rootResponse, request, maxProducts, sink, onProgress }) {
  const origin = new URL(rootResponse.url).origin
  const productsResult = await fetchTrayPages(origin, request, 'products', 'Products', maxProducts)
  if (!productsResult.items.length) throw new Error('A API pública da Tray não retornou produtos.')

  let variantsResult = { items: [], pagesScanned: 0 }
  try {
    variantsResult = await fetchTrayPages(origin, request, 'variants', 'Variants', Number.POSITIVE_INFINITY)
  } catch {
    // Algumas lojas deixam produtos públicos, mas restringem a listagem global de variações.
  }
  const variantsByProduct = new Map()
  for (const variant of variantsResult.items) {
    const productId = text(variant.product_id)
    if (!productId) continue
    if (!variantsByProduct.has(productId)) variantsByProduct.set(productId, [])
    variantsByProduct.get(productId).push(variant)
  }

  await sink.push(productsResult.items.map((product) => trayProduct(origin, product, variantsByProduct)))
  await sink.flush()
  const pagesScanned = 1 + productsResult.pagesScanned + variantsResult.pagesScanned
  await onProgress({ progress: 90, pagesScanned, candidates: sink.count, platform: 'tray' })
  return { candidateCount: sink.count, pagesScanned }
}

export function parseVestiCompanyId(html) {
  const source = String(html || '')
  const patterns = [
    /\\?"company\\?"\s*:\s*\{\s*\\?"id\\?"\s*:\s*\\?"([0-9a-f-]{36})\\?"/i,
    /"company"\s*:\s*\{\s*"id"\s*:\s*"([0-9a-f-]{36})"/i,
    /companyId\\?"?\s*:\s*\\?"([0-9a-f-]{36})/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (match) return match[1]
  }
  return ''
}

export function enrichVestiCandidate(candidate, detail) {
  const product = detail?.product_group || detail?.product || detail
  if (!product || typeof product !== 'object') return candidate
  const colorMap = new Map(asArray(product.colors).map((item) => [text(item.id), text(item.name)]))
  const sizeMap = new Map(asArray(product.sizes).map((item) => [text(item.id), text(item.name)]))
  const colors = unique([...colorMap.values()])
  const sizes = unique([...sizeMap.values()])
  const properties = []
  if (colors.length) properties.push({ name: 'Cor', values: colors })
  if (sizes.length) properties.push({ name: 'Tamanho', values: sizes })

  const variants = asArray(product.stocks).map((stock) => {
    const color = colorMap.get(text(stock.color_id)) || ''
    const size = sizeMap.get(text(stock.size_id)) || ''
    const promotional = numberValue(stock.price_promotional)
    const regular = numberValue(stock.price ?? product.price)
    return {
      external_id: text(stock.id),
      title: [color, size].filter(Boolean).join(' / '),
      sku: text(stock.sku ?? stock.reference ?? stock.barcode),
      color,
      size,
      price: promotional && promotional > 0 ? promotional : regular,
      available: stock.sell !== false && Number(stock.quantity ?? 1) !== 0,
      properties: [color && { name: 'Cor', value: color }, size && { name: 'Tamanho', value: size }].filter(Boolean),
    }
  }).filter((variant) => variant.external_id || variant.sku || variant.color || variant.size)

  const promotional = numberValue(product.price_promotional)
  const regular = numberValue(product.price ?? candidate.price)
  const images = preferredMediaUrls(product.media)
  return {
    ...candidate,
    title: text(product.name) || candidate.title,
    description: text(product.full_description ?? product.description) || candidate.description,
    sku: text(product.code ?? product.sku) || candidate.sku,
    category: text(asArray(product.categories)[0]?.name ?? product.category?.name) || candidate.category,
    brand: text(product.brand?.name ?? product.brand) || candidate.brand,
    images: images.length ? images : candidate.images,
    variants: variants.length ? variants : candidate.variants,
    properties: properties.length ? properties : candidate.properties,
    price: promotional && promotional > 0 ? promotional : regular,
    price_text: text(promotional && promotional > 0 ? promotional : regular),
    source: 'vesti-public-api-detail',
  }
}
