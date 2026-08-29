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


function facilZapMediaUrl(value, baseUrl) {
  const raw = text(value)
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  const path = raw.replace(/^\/+/, '')
  // O payload público do FácilZap entrega imagens como `produtos/arquivo.webp`.
  // Esses caminhos pertencem ao CDN de arquivos, inclusive quando a loja usa domínio próprio.
  if (/^(?:produtos|lojas|categorias|banners|uploads)\//i.test(path)) {
    return `https://arquivos.facilzap.app.br/${path}`
  }
  return absolute(raw, baseUrl)
}

function facilZapMediaUrls(value, baseUrl) {
  const found = []
  const visit = (item) => {
    if (!item) return
    if (typeof item === 'string') {
      const url = facilZapMediaUrl(item, baseUrl)
      if (url) found.push(url)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (typeof item !== 'object') return
    for (const key of ['url', 'src', 'image', 'imagem', 'foto', 'arquivo', 'fallback', 'caminho', 'path']) {
      if (typeof item[key] === 'string') visit(item[key])
    }
    for (const key of ['normal', 'zoom', 'thumb', 'media', 'images', 'imagens', 'fotos']) {
      if (item[key]) visit(item[key])
    }
  }
  visit(value)
  return unique(found)
}

function objectEntries(value) {
  if (Array.isArray(value)) return value.map((item, index) => [String(item?.id ?? index), item])
  if (value && typeof value === 'object') return Object.entries(value)
  return []
}

function positiveNumber(...values) {
  for (const value of values) {
    const parsed = numberValue(value)
    if (parsed != null && parsed > 0) return parsed
  }
  return null
}

function facilZapVariantProperties(nameValue, colorValue) {
  const name = text(nameValue)
  const color = text(colorValue)
  const properties = []
  const technicalColor = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(color)

  const sizeColorMatch = /^(pp|p|m|g|gg|xg|xgg|eg|egg|\d{1,3})\s*\(([^)]+)\)$/i.exec(name)
  const sizeMatch = /^(?:tamanho|tam)\s*[:\-]?\s*(.+)$/i.exec(name)
  const plainSize = /^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\d{1,3})$/i.test(name)

  if (sizeColorMatch) {
    properties.push({ name: 'Tamanho', value: text(sizeColorMatch[1]) })
    properties.push({ name: 'Cor', value: text(sizeColorMatch[2]) })
  } else if (sizeMatch?.[1]) {
    properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
    if (color) properties.push({ name: 'Cor', value: color })
  } else if (plainSize) {
    properties.push({ name: 'Tamanho', value: name })
    if (color) properties.push({ name: 'Cor', value: color })
  } else if (technicalColor && name) {
    // FácilZap moderno envia o nome humano em `nome` e a amostra visual em `cor`.
    // A variação da loja deve mostrar "Prata"/"Grafite", não "#b8bec4".
    properties.push({ name: 'Cor', value: name })
  } else if (color) {
    properties.push({ name: 'Cor', value: color })
    if (name && name.toLocaleLowerCase('pt-BR') != color.toLocaleLowerCase('pt-BR')) properties.push({ name: 'Variação', value: name })
  } else if (name) {
    properties.push({ name: 'Variação', value: name })
  }
  return properties
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

  // Builds mais novos do FácilZap (inclusive domínios próprios) expõem a rota
  // de carregamento como uma constante de seções, usando página 0 na home. A mesma
  // rota aceita páginas 1..N para o catálogo completo.
  const modernRoute = /const\s+urlCarregarSecoesProdutos\s*=\s*[`'"]([^`'"]+)[`'"]/i.exec(source)
  if (modernRoute?.[1]) {
    const rawUrl = decodeHtmlJson(modernRoute[1]).replace(/\\\//g, '/')
    if (/\/carregar_produtos\/0\//i.test(rawUrl)) {
      return {
        urlCarregarProdutosTemplate: rawUrl
          .replace(/\/carregar_produtos\/0\//i, '/carregar_produtos/{PAGE}/')
          .replace(/\/todas\//i, '/{CATEGORY}/'),
        searchId: '',
        categoria: 0,
        paginaEspecifica: '',
      }
    }
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

function normalizeVariation(item, fallbackId = '', parent = {}) {
  if (!item || typeof item !== 'object') return null
  const externalId = text(item.id ?? item.idVariacao ?? item.variacao_id ?? item.variant_id ?? fallbackId)
  const title = text(item.nome ?? item.name ?? item.titulo ?? item.title)
  const properties = facilZapVariantProperties(title, item.cor ?? item.color ?? item.nome_cor)
  const color = text(properties.find((property) => property.name === 'Cor')?.value)
  const size = text(properties.find((property) => property.name === 'Tamanho')?.value)
  const priceMeta = parent?.precos_produto?.variacoes?.[externalId] ?? parent?.precos_produto?.variations?.[externalId] ?? {}
  const stockRaw = parent?.estoque?.[externalId] ?? item.estoque ?? item.stock
  const availabilityRaw = parent?.disponibilidade?.[externalId] ?? item.disponivel ?? item.available ?? item.ativo ?? item.active
  const controlled = parent?.controlar_estoque === true
  const stock = numberValue(stockRaw)
  const explicitAvailable = !['0', 'false', 'indisponivel', 'indisponível'].includes(text(availabilityRaw).toLowerCase())
  return {
    external_id: externalId,
    title,
    sku: text(item.sku ?? item.codigo ?? item.referencia ?? item.code ?? parent?.sku_variacoes?.[externalId]),
    color,
    size,
    price: positiveNumber(
      item.preco_promocional,
      item.preco,
      item.preco_venda,
      item.valor,
      item.price,
      priceMeta?.promocional,
      priceMeta?.padrao,
    ),
    available: explicitAvailable && (!controlled || stock == null || stock > 0),
    stock,
    properties,
  }
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
    const images = facilZapMediaUrls([
      item.imagens,
      item.images,
      item.fotos,
      item.media,
      item.imagem,
      item.image,
      item.imagens_variacoes,
    ], sourceUrl)

    // Na API real `variacoes` é um objeto indexado pelo ID da variação.
    const variantSource = item.variacoes ?? item.variants ?? item.grade ?? item.grades ?? item.opcoes
    const variants = objectEntries(variantSource)
      .map(([variantId, variant]) => normalizeVariation(variant, variantId, item))
      .filter((variant) => variant && (variant.external_id || variant.sku || variant.properties.length))

    const propertyMap = new Map()
    const addProperty = (nameValue, valueValue) => {
      const name = text(nameValue)
      const value = text(valueValue)
      if (!name || !value) return
      const key = name.toLocaleLowerCase('pt-BR')
      if (!propertyMap.has(key)) propertyMap.set(key, { name, values: [] })
      const group = propertyMap.get(key)
      if (!group.values.some((entry) => entry.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))) group.values.push(value)
    }
    for (const variant of variants) for (const property of variant.properties || []) addProperty(property.name, property.value)
    for (const entry of asArray(item.cores ?? item.colors)) addProperty('Cor', typeof entry === 'object' ? entry.nome ?? entry.name ?? entry.cor ?? entry.color : entry)
    for (const entry of asArray(item.tamanhos ?? item.sizes)) addProperty('Tamanho', typeof entry === 'object' ? entry.nome ?? entry.name ?? entry.tamanho ?? entry.size : entry)
    const properties = [...propertyMap.values()].filter((group) => group.values.length)

    const priceMeta = item.precos_produto || {}
    const effectivePrice = positiveNumber(
      priceMeta?.preco_a_partir?.ativado !== false ? priceMeta?.preco_a_partir?.preco : null,
      priceMeta?.promocional,
      item.preco_promocional,
      item.preco,
      item.preco_venda,
      item.valor,
      item.price,
      ...variants.map((variant) => variant.price),
    )
    const controlled = item.controlar_estoque === true
    const totalAvailable = numberValue(item.total_disponibilidade ?? item.total_estoque)
    const available = item.status !== false && (!controlled || totalAvailable == null || totalAvailable > 0)

    products.push({
      source_url: productUrl || sourceUrl,
      external_id: externalId,
      title,
      description: text(item.descricao ?? item.description ?? item.detalhes ?? item.details),
      sku: text(item.sku ?? item.codigo ?? item.referencia ?? item.code),
      category: text(item.categoria_nome ?? item.categoria?.nome ?? item.categoria ?? item.category?.name ?? item.category),
      brand: text(item.marca?.nome ?? item.marca ?? item.brand?.name ?? item.brand),
      images,
      variants,
      properties,
      price: effectivePrice,
      price_text: effectivePrice == null ? '' : String(effectivePrice),
      currency: text(item.moeda ?? item.currency) || 'BRL',
      availability: available ? 'InStock' : 'OutOfStock',
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
