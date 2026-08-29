from pathlib import Path

# ---- scanner-platforms.mjs ----
p = Path('server/scanner-platforms.mjs')
s = p.read_text()

anchor = """function mediaUrls(value, baseUrl) {
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
"""
insert = anchor + """

function facilZapMediaUrl(value, baseUrl) {
  const raw = text(value)
  if (!raw) return ''
  if (/^https?:\\/\\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  const path = raw.replace(/^\\/+/, '')
  // O payload público do FácilZap entrega imagens como `produtos/arquivo.webp`.
  // Esses caminhos pertencem ao CDN de arquivos, inclusive quando a loja usa domínio próprio.
  if (/^(?:produtos|lojas|categorias|banners|uploads)\\//i.test(path)) {
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
  if (color) properties.push({ name: 'Cor', value: color })

  const sizeMatch = /^(?:tamanho|tam)\\s*[:\\-]?\\s*(.+)$/i.exec(name)
  if (sizeMatch?.[1]) properties.push({ name: 'Tamanho', value: text(sizeMatch[1]) })
  else if (/^(?:pp|p|m|g|gg|xg|xgg|eg|egg|\\d{1,3})$/i.test(name)) properties.push({ name: 'Tamanho', value: name })
  else if (name && !color) properties.push({ name: 'Variação', value: name })
  return properties
}
"""
if 'function facilZapMediaUrl' not in s:
    if anchor not in s: raise SystemExit('mediaUrls anchor not found')
    s = s.replace(anchor, insert)

start = s.index('function normalizeVariation(item) {')
end = s.index('\n\nexport function facilZapProducts', start)
new_normalize = """function normalizeVariation(item, fallbackId = '', parent = {}) {
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
"""
s = s[:start] + new_normalize + s[end:]

start = s.index('export function facilZapProducts(payload, sourceUrl) {')
end = s.index('\n\nexport function parseVestiContext', start)
new_facil = """export function facilZapProducts(payload, sourceUrl) {
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
"""
s = s[:start] + new_facil + s[end:]
p.write_text(s)

# ---- scanner-collector.mjs: follow the simple JS redirect used by facilzap.app.br ----
p = Path('server/scanner-collector.mjs')
s = p.read_text()
anchor = """export function detectPlatform(html, sourceUrl = '') {
  return detectStorefrontPlatform(html, sourceUrl)
}
"""
insert = anchor + """

function facilZapJavascriptRedirect(html, currentUrl) {
  let host = ''
  try { host = new URL(currentUrl).hostname.toLowerCase() } catch { return '' }
  if (host !== 'facilzap.app.br' && !host.endsWith('.facilzap.app.br')) return ''
  const source = String(html || '')
  if (source.length > 4096) return ''
  const match = /(?:window\\.)?location(?:\\.href)?\\s*=\\s*['\"](https?:\\/\\/[^'\"]+)['\"]/i.exec(source)
  if (!match) return ''
  try {
    const target = new URL(match[1])
    return ['http:', 'https:'].includes(target.protocol) ? target.toString() : ''
  } catch { return '' }
}
"""
if 'function facilZapJavascriptRedirect' not in s:
    if anchor not in s: raise SystemExit('detectPlatform anchor not found')
    s = s.replace(anchor, insert)

old = """  const rootResponse = await request(sourceUrl)
  if (!rootResponse.ok) throw new Error(`A loja respondeu HTTP ${rootResponse.status}.`)
  if (!rootResponse.contentType.includes('html')) throw new Error('A URL informada não parece ser uma página de loja.')

  const platform = detectPlatform(rootResponse.body, rootResponse.url)
"""
new = """  let rootResponse = await request(sourceUrl)
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
"""
if old not in s: raise SystemExit('collectCatalog root anchor not found')
s = s.replace(old, new)
p.write_text(s)

# ---- scanner-module7.test.mjs: make the fixture match the real API contract ----
p = Path('server/scanner-module7.test.mjs')
s = p.read_text()
old = """const mappedFacil = facilZapProducts({ produtos: [{
  id: 11,
  nome: 'Vestido Solar',
  descricao: 'Midi',
  codigo: 'VS-11',
  preco: 'R$ 49,90',
  categoria: { nome: 'Vestidos' },
  fotos: [{ url: '/media/11.jpg' }],
  cores: [{ nome: 'Azul' }, { nome: 'Preto' }],
  tamanhos: ['P', 'M'],
  variacoes: [{ id: 101, sku: 'VS-11-P-AZ', cor: 'Azul', tamanho: 'P', preco: '49,90' }],
}] }, 'https://facilzap.app.br/minhaloja/')
assert.equal(mappedFacil.products.length, 1)
assert.equal(mappedFacil.products[0].price, 49.9)
assert.equal(mappedFacil.products[0].sku, 'VS-11')
assert.deepEqual(mappedFacil.products[0].properties[0].values, ['Azul', 'Preto'])
assert.equal(mappedFacil.products[0].variants[0].size, 'P')
"""
new = """const mappedFacil = facilZapProducts({ produtos: [{
  id: '3652733',
  nome: 'Kit Calcinhas Total Confort',
  descricao: 'Produto realista de teste',
  preco: 75,
  categoria: 47650,
  categoria_nome: 'Calcinhas',
  sku: 'FZ3652733',
  controlar_estoque: true,
  total_disponibilidade: 6,
  imagens: ['produtos/1765916872_baba5b625a9226b240b3.webp'],
  precos_produto: {
    preco_a_partir: { preco: '60', ativado: true },
    promocional: '70.00',
    variacoes: { '1773005': { padrao: '60', promocional: false }, '1773006': { padrao: '60', promocional: false } },
  },
  variacoes: {
    '1773005': { id: '1773005', nome: 'Tamanho M', cor: '' },
    '1773006': { id: '1773006', nome: 'Tamanho G', cor: '' },
  },
  sku_variacoes: { '1773005': 'FZ3652733.6', '1773006': 'FZ3652733.15' },
  disponibilidade: { '1773005': '1', '1773006': '1' },
  estoque: { '1773005': 3, '1773006': 5 },
}] }, 'https://minhaloja.com.br/')
assert.equal(mappedFacil.products.length, 1)
assert.equal(mappedFacil.products[0].price, 60)
assert.equal(mappedFacil.products[0].sku, 'FZ3652733')
assert.equal(mappedFacil.products[0].category, 'Calcinhas')
assert.equal(mappedFacil.products[0].images[0], 'https://arquivos.facilzap.app.br/produtos/1765916872_baba5b625a9226b240b3.webp')
assert.deepEqual(mappedFacil.products[0].properties[0].values, ['M', 'G'])
assert.equal(mappedFacil.products[0].variants[0].size, 'M')
assert.equal(mappedFacil.products[0].variants[0].sku, 'FZ3652733.6')
assert.equal(mappedFacil.products[0].variants[0].price, 60)
assert.equal(mappedFacil.products[0].availability, 'InStock')
"""
if old not in s: raise SystemExit('facil fixture anchor not found')
s = s.replace(old, new)

# Add JS redirect test after facil collected block.
anchor = """assert.ok(facilCalls.some((call) => call.options.method === 'POST'))
"""
extra = anchor + """

let redirectedRootCalls = []
const redirectedRequest = async (input, options = {}) => {
  const url = String(input)
  redirectedRootCalls.push(url)
  if (url === 'https://facilzap.app.br/minhaloja') return response(url, `<script>window.location.href = 'https://loja-propria.example';</script>`)
  if (url === 'https://loja-propria.example/') return response(url, facilRoot.replaceAll('https://facilzap.app.br/minhaloja', 'https://loja-propria.example'))
  const match = /carregar_produtos\\/(\\d+)\\/todas\\//.exec(url)
  if (!match) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
  const page = Number(match[1])
  if (page > 1) return response(url, JSON.stringify({ acao: 'sem_mais_produtos' }), 'application/json')
  return response(url, JSON.stringify({ produtos: [{ id: 1, nome: 'Produto redirecionado', sku: 'FZ1', preco: 10, imagens: ['produtos/foto.webp'] }] }), 'application/json')
}
const redirectedCollected = await collectCatalog('https://facilzap.app.br/minhaloja', { request: redirectedRequest, strictPlatformAdapters: true })
assert.equal(redirectedCollected.platform, 'facilzap')
assert.equal(redirectedCollected.candidateCount, 1)
assert.equal(redirectedCollected.candidates[0].images[0], 'https://arquivos.facilzap.app.br/produtos/foto.webp')
assert.ok(redirectedRootCalls.includes('https://loja-propria.example/'))
"""
if 'redirectedCollected' not in s:
    if anchor not in s: raise SystemExit('redirect test anchor not found')
    s = s.replace(anchor, extra)
p.write_text(s)
