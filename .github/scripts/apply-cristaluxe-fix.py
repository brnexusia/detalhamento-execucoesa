from pathlib import Path

p = Path('server/scanner-platforms.mjs')
s = p.read_text()
needle = """  // Some storefront builds serialize the runtime as data-* attributes.\n  const $ = load(source)\n"""
insert = """  // Builds mais novos do FácilZap (inclusive domínios próprios) expõem a rota\n  // de carregamento como uma constante de seções, usando página 0 na home. A mesma\n  // rota aceita páginas 1..N para o catálogo completo.\n  const modernRoute = /const\\s+urlCarregarSecoesProdutos\\s*=\\s*[`'\"]([^`'\"]+)[`'\"]/i.exec(source)\n  if (modernRoute?.[1]) {\n    const rawUrl = decodeHtmlJson(modernRoute[1]).replace(/\\\\\\//g, '/')\n    if (/\\/carregar_produtos\\/0\\//i.test(rawUrl)) {\n      return {\n        urlCarregarProdutosTemplate: rawUrl\n          .replace(/\\/carregar_produtos\\/0\\//i, '/carregar_produtos/{PAGE}/')\n          .replace(/\\/todas\\//i, '/{CATEGORY}/'),\n        searchId: '',\n        categoria: 0,\n        paginaEspecifica: '',\n      }\n    }\n  }\n\n  // Some storefront builds serialize the runtime as data-* attributes.\n  const $ = load(source)\n"""
if needle not in s:
    raise SystemExit('scanner-platforms anchor not found')
s = s.replace(needle, insert, 1)
p.write_text(s)

p = Path('server/scanner-module7.test.mjs')
s = p.read_text()
needle = """assert.equal(runtime.searchId, 'search-123')\n\nconst mappedFacil = facilZapProducts"""
insert = """assert.equal(runtime.searchId, 'search-123')\n\nconst modernFacilRoot = `<!doctype html><html><head>\n<script src=\"https://assets-cdn.facilzap.app.br/catalogo.js\"></script>\n</head><body><script>\nconst urlCarregarSecoesProdutos = ` + "`" + `https://cristaluxe.example/c/atacado/carregar_produtos/0/todas/11933520201` + "`" + `;\n</script></body></html>`\nconst modernRuntime = extractFacilZapRuntime(modernFacilRoot)\nassert.ok(modernRuntime)\nassert.equal(modernRuntime.urlCarregarProdutosTemplate, 'https://cristaluxe.example/c/atacado/carregar_produtos/{PAGE}/{CATEGORY}/11933520201')\n\nconst mappedFacil = facilZapProducts"""
if needle not in s:
    raise SystemExit('module7 runtime anchor not found')
s = s.replace(needle, insert, 1)

anchor = """assert.ok(facilCalls.some((call) => call.options.method === 'POST'))\n\n\nlet redirectedRootCalls = []"""
block = """assert.ok(facilCalls.some((call) => call.options.method === 'POST'))\n\nconst modernCalls = []\nconst modernRequest = async (input, options = {}) => {\n  const url = String(input)\n  modernCalls.push({ url, options })\n  if (url === 'https://cristaluxe.example/') return response(url, modernFacilRoot)\n  const match = /carregar_produtos\\/(\\d+)\\/todas\\//.exec(url)\n  if (!match) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }\n  const page = Number(match[1])\n  if (page === 3) return response(url, JSON.stringify({ acao: 'sem_mais_produtos' }), 'application/json')\n  const count = page === 1 ? 12 : 7\n  const start = page === 1 ? 0 : 12\n  return response(url, JSON.stringify({ produtos: Array.from({ length: count }, (_, index) => ({\n    id: start + index + 1,\n    nome: `Cristaluxe ${start + index + 1}`,\n    sku: `CR-${start + index + 1}`,\n    preco: '29,90',\n    imagens: [`produtos/cr-${start + index + 1}.webp`],\n    descricao: 'Descrição completa',\n  })) }), 'application/json')\n}\nconst modernCollected = await collectCatalog('https://cristaluxe.example/', { request: modernRequest, strictPlatformAdapters: true })\nassert.equal(modernCollected.platform, 'facilzap')\nassert.equal(modernCollected.candidateCount, 19)\nassert.equal(modernCollected.candidates.at(-1).sku, 'CR-19')\nassert.equal(modernCollected.candidates[0].images[0], 'https://arquivos.facilzap.app.br/produtos/cr-1.webp')\nassert.ok(modernCalls.some((call) => call.url.includes('/carregar_produtos/2/todas/')))\n\n\nlet redirectedRootCalls = []"""
if anchor not in s:
    raise SystemExit('module7 collect anchor not found')
s = s.replace(anchor, block, 1)
p.write_text(s)
