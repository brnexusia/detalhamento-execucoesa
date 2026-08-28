from pathlib import Path
import re

path = Path('server/scanner-collector.mjs')
text = path.read_text()

old = "import { load } from 'cheerio'\n"
new = "import { load } from 'cheerio'\nimport { detectStorefrontPlatform, extractFacilZapRuntime, facilZapProducts, parseVestiContext, vestiProducts, isZapFacilCatalogPage } from './scanner-platforms.mjs'\n"
if old not in text:
    raise SystemExit('import anchor missing')
text = text.replace(old, new, 1)

pattern = r"export function detectPlatform\(html\) \{[\s\S]*?\n\}"
replacement = """export function detectPlatform(html, sourceUrl = '') {
  return detectStorefrontPlatform(html, sourceUrl)
}"""
text, count = re.subn(pattern, lambda _m: replacement, text, count=1)
if count != 1:
    raise SystemExit(f'detectPlatform replace count={count}')

old = """  const requestImpl = url.protocol === 'https:' ? https.request : http.request
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
"""
new = """  const requestImpl = url.protocol === 'https:' ? https.request : http.request
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
"""
if old not in text:
    raise SystemExit('safeRequest anchor missing')
text = text.replace(old, new, 1)

old = """    request.on('timeout', () => request.destroy(new Error('A página demorou demais para responder.')))
    request.on('error', reject)
    request.end()
"""
new = """    request.on('timeout', () => request.destroy(new Error('A página demorou demais para responder.')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
"""
if old not in text:
    raise SystemExit('request.end anchor missing')
text = text.replace(old, new, 1)

anchor = "async function mapLimit(values, limit, mapper) {"
if anchor not in text:
    raise SystemExit('mapLimit anchor missing')
insert = r'''
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
    await sink.push(mapped.products)
    await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count, platform: 'facilzap' })
    page += 1
  }
  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

async function collectVesti(rootResponse, request, maxProducts, sink, onProgress) {
  const context = parseVestiContext(rootResponse.url, rootResponse.body)
  if (!context) throw new Error('Não foi possível identificar loja e catálogo Vesti pela URL pública.')
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
    const products = vestiProducts(payload, context)
    if (!products.length) break
    const signature = `${products[0]?.external_id || ''}|${products.at(-1)?.external_id || ''}|${products.length}`
    if (pageSignatures.has(signature)) break
    pageSignatures.add(signature)
    await sink.push(products)
    await onProgress({ progress: Math.min(90, 15 + Math.floor(Math.log2(page + 1) * 8)), pagesScanned, candidates: sink.count, platform: 'vesti' })
    if (!payload?.links?.next) break
  }
  await sink.flush()
  return { candidateCount: sink.count, pagesScanned }
}

'''
text = text.replace(anchor, insert + anchor, 1)

text = text.replace("const platform = detectPlatform(rootResponse.body)", "const platform = detectPlatform(rootResponse.body, rootResponse.url)", 1)

anchor = """  if (platform === 'shopify') {
"""
branch = """  if (platform === 'facilzap') {
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

  if (platform === 'shopify') {
"""
if anchor not in text:
    raise SystemExit('platform branch anchor missing')
text = text.replace(anchor, branch, 1)

path.write_text(text)
print('M7_PATCH_OK')
