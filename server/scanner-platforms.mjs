import { load } from 'cheerio'

const text = (value) => String(value ?? '').trim()
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value]
const unique = (values) => [...new Set(values.map((value) => text(value)).filter(Boolean))]

function numberValue(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let raw = text(value).replace(/\s/g, '').replace(/[^0-9,.-]/g, '')
  if (!raw) return null
  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) raw = raw.replace(/\./g, '').replace(',', '.')
    else raw = raw.replace(/,/g, '')
  } else if (raw.includes(',')) raw = raw.replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function absolute(value, baseUrl) {
  try { return value ? new URL(String(value), baseUrl).toString() : '' } catch { return '' }
}

function mediaUrls(value, baseUrl) {
  const found = []
  const visit = (item) => {
    if (!item) return
    if (typeof item === 'string') {
      const url = absolute(item, baseUrl)
      if (url) found.push(url)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (typeof item !== 'object') return
    for (const key of ['url', 'src', 'image', 'imagem', 'foto', 'arquivo', 'fallback']) {
      if (typeof item[key] === 'string') visit(item[key])
    }
    for (const key of ['normal', 'zoom', 'thumb', 'media', 'images', 'imagens', 'fotos']) {
      if (item[key]) visit(item[key])
    }
  }
  visit(value)
  return unique(found)
}

export function detectStorefrontPlatform(html, sourceUrl = '') {
  const value = String(html || '').toLowerCase()
  let host = ''
  try { host = new URL(sourceUrl).hostname.toLowerCase() } catch {}

  if (host === 'vesti.co' || host === 'v.vesti.mobi' || host.endsWith('.vesti.co') || host.endsWith('.vesti.mobi') || value.includes('cdn-op.vesti.mobi') || value.includes('powered by vesti')) return 'vesti'
  if (host === 'facilzap.app.br' || host.endsWith('.facilzap.app.br') || value.includes('fzcatalogoruntime') || value.includes('assets-cdn.facilzap.app.br')) return 'facilzap'
  if (host === 'zapfacil.shop' || host.endsWith('.zapfacil.shop') || host === 'zapfacil.com.br' || host.endsWith('.zapfacil.com.br')) return 'zapfacil'
  if (host.endsWith('.lojavirtualnuvem.com.br') || host.endsWith('.mitiendanube.com') || value.includes('nuvemshop') || value.includes('tiendanube')) return 'nuvemshop'
  if (host.endsWith('.lojaintegrada.com.br') || value.includes('lojaintegrada') || value.includes('cdn.awsli.com.br')) return 'lojaintegrada'
  if (host.endsWith('.commercesuite.com.br') || host.endsWith('.tray.com.br') || value.includes('tray.com.br') || value.includes('traycdn.com')) return 'tray'
  if (value.includes('cdn.shopify.com') || value.includes('shopify.theme') || value.includes('shopify-section')) return 'shopify'
  if (value.includes('woocommerce') || value.includes('wc-block') || value.includes('wp-content/plugins/woocommerce')) return 'woocommerce'
  return 'generic'
}

function decodeHtmlJson(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
}

export function extractFacilZapRuntime(html) {
  const source = String(html || '')
  const patterns = [
    /window\.FZCatalogoRuntime\.listagem\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/i,
    /FZCatalogoRuntime\.listagem\s*=\s*(\{[\s\S]*?\});/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    if (!match) continue
    try {
      const parsed = JSON.parse(decodeHtmlJson(match[1]))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }

  // Some storefront builds serialize the runtime as data-* attributes.
  const $ = load(source)
  const node = $('[data-url-carregar-produtos-template]').first()
  if (node.length) {
    return {
      urlCarregarProdutosTemplate: node.attr('data-url-carregar-produtos-template') || '',
      searchId: node.attr('data-search-id') || '',
      categoria: Number(node.attr('data-categoria') || 0),
      paginaEspecifica: node.attr('data-pagina-especifica') || '',
    }
  }
  return null
}

function normalizeVariation(item) {
  if (!item || typeof item !== 'object') return null
  const result = {
    external_id: text(item.id ?? item.idVariacao ?? item.variacao_id ?? item.variant_id),
    title: text(item.nome ?? item.name ?? item.titulo ?? item.title),
    sku: text(item.sku ?? item.codigo ?? item.referencia ?? item.code),
    color: text(item.cor ?? item.color ?? item.nome_cor),
    size: text(item.tamanho ?? item.size ?? item.nome_tamanho),
    price: numberValue(item.preco ?? item.preco_venda ?? item.valor ?? item.price),
    available: item.disponivel ?? item.available ?? item.ativo ?? item.active ?? true,
  }
  const properties = []
  if (result.color) properties.push({ name: 'Cor', value: result.color })
  if (result.size) properties.push({ name: 'Tamanho', value: result.size })
  result.properties = properties
  return result
}

export function facilZapProducts(payload, sourceUrl) {
  if (!payload) return { end: false, products: [] }
  if (text(payload.acao).toLowerCase() === 'sem_mais_produtos') return { end: true, products: [] }
  const raw = payload.produtos ?? payload.products ?? payload.data ?? payload
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
  const products = []

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const externalId = text(item.id ?? item.idProduto ?? item.produto_id ?? item.product_id)
    const title = text(item.nome ?? item.name ?? item.titulo ?? item.title)
    if (!title) continue
    const productUrl = absolute(item.url ?? item.link ?? item.permalink ?? (externalId ? `produto/${externalId}` : ''), sourceUrl)
    const images = mediaUrls(item.imagens ?? item.images ?? item.fotos ?? item.media ?? item.imagem ?? item.image, sourceUrl)
    const rawVariants = asArray(item.variacoes ?? item.variants ?? item.grade ?? item.grades ?? item.opcoes)
    const variants = rawVariants.map(normalizeVariation).filter(Boolean)
    const properties = []
    const colors = unique(asArray(item.cores ?? item.colors).map((entry) => typeof entry === 'object' ? entry.nome ?? entry.name ?? entry.cor ?? entry.color : entry))
    const sizes = unique(asArray(item.tamanhos ?? item.sizes).map((entry) => typeof entry === 'object' ? entry.nome ?? entry.name ?? entry.tamanho ?? entry.size : entry))
    if (colors.length) properties.push({ name: 'Cor', values: colors })
    if (sizes.length) properties.push({ name: 'Tamanho', values: sizes })

    products.push({
      source_url: productUrl || sourceUrl,
      external_id: externalId,
      title,
      description: text(item.descricao ?? item.description ?? item.detalhes ?? item.details),
      sku: text(item.sku ?? item.codigo ?? item.referencia ?? item.code),
      category: text(item.categoria?.nome ?? item.categoria ?? item.category?.name ?? item.category),
      brand: text(item.marca?.nome ?? item.marca ?? item.brand?.name ?? item.brand),
      images,
      variants,
      properties,
      price: numberValue(item.preco ?? item.preco_venda ?? item.valor ?? item.price),
      price_text: text(item.preco_formatado ?? item.price_text ?? item.preco ?? item.price),
      currency: text(item.moeda ?? item.currency) || 'BRL',
      availability: text(item.disponibilidade ?? item.availability ?? (item.disponivel === false ? 'OutOfStock' : '')),
      source: 'facilzap-public-pagination',
    })
  }
  return { end: products.length === 0, products }
}

export function parseVestiContext(sourceUrl, html = '') {
  let url
  try { url = new URL(sourceUrl) } catch { return null }
  const pathMatch = /^\/([^/]+)\/catalogo\/([^/?#]+)/i.exec(url.pathname)
  let schemeUrl = pathMatch?.[1] || ''
  let catalogId = pathMatch?.[2] || ''

  if ((!schemeUrl || !catalogId) && html) {
    const source = String(html)
    schemeUrl ||= /\\?"schemeUrl\\?"\s*:\s*\\?"([^"\\]+)\\?"/i.exec(source)?.[1] || ''
    catalogId ||= /\\?"catalog(?:Id)?\\?"\s*:\s*\{?\s*\\?"id\\?"\s*:\s*\\?"([^"\\]+)\\?"/i.exec(source)?.[1] || ''
  }
  if (!schemeUrl || !catalogId) return null
  return { schemeUrl, catalogId, catalogBaseUrl: `${url.origin}/${schemeUrl}/catalogo/${catalogId}` }
}

export function vestiProducts(payload, context) {
  const list = Array.isArray(payload?.products) ? payload.products : []
  return list.map((item) => {
    const colors = unique(asArray(item.colors).map((entry) => entry?.name ?? entry?.nome ?? entry))
    const sizes = unique(asArray(item.sizes).map((entry) => entry?.name ?? entry?.nome ?? entry))
    const properties = []
    if (colors.length) properties.push({ name: 'Cor', values: colors })
    if (sizes.length) properties.push({ name: 'Tamanho', values: sizes })

    const variants = asArray(item.skus ?? item.stocks ?? item.variants).map((variant) => {
      if (!variant || typeof variant !== 'object') return null
      const color = colors.find((name) => text(name).toLowerCase() === text(variant.color_name ?? variant.color?.name).toLowerCase()) || text(variant.color_name ?? variant.color?.name)
      const size = sizes.find((name) => text(name).toLowerCase() === text(variant.size_name ?? variant.size?.name).toLowerCase()) || text(variant.size_name ?? variant.size?.name)
      return {
        external_id: text(variant.id ?? variant.stockId ?? variant.stock_id),
        title: text(variant.name ?? variant.title),
        sku: text(variant.sku ?? variant.code),
        color,
        size,
        price: numberValue(variant.price ?? item.price),
        available: (variant.qnt ?? variant.quantity ?? variant.stock ?? 1) !== 0,
        properties: [color && { name: 'Cor', value: color }, size && { name: 'Tamanho', value: size }].filter(Boolean),
      }
    }).filter(Boolean)

    const firstPrice = asArray(item.prices)[0]
    const price = numberValue(firstPrice?.price ?? item.price)
    const slug = text(item.slug)
    return {
      source_url: slug ? `${context.catalogBaseUrl}/produto/${slug}` : context.catalogBaseUrl,
      external_id: text(item.id),
      title: text(item.name),
      description: text(item.description ?? item.full_description),
      sku: text(item.code ?? item.sku),
      category: text(item.category?.name ?? item.category ?? asArray(item.categories)[0]?.name),
      brand: text(item.brand?.name ?? item.brand),
      images: mediaUrls(item.media ?? item.images, context.catalogBaseUrl),
      variants,
      properties,
      price,
      price_text: price == null ? '' : String(price),
      currency: 'BRL',
      availability: item.stockout === true ? 'OutOfStock' : 'InStock',
      source: 'vesti-public-api',
    }
  }).filter((item) => item.title)
}

export function isZapFacilCatalogPage(html) {
  const value = String(html || '').toLowerCase()
  return /(?:schema\.org\/product|product:price|data-product|\/produto\/|\/product\/)/i.test(value)
}
