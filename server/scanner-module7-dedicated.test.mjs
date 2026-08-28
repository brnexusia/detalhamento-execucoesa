import assert from 'node:assert/strict'
import { collectCatalog } from './scanner-collector.mjs'
import { parseVestiCompanyId } from './scanner-platform-collectors.mjs'

function response(url, body, contentType = 'text/html') {
  return { status: 200, ok: true, url, contentType, headers: {}, body }
}

function productHtml(name, price, sku = '') {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    sku,
    image: [`https://cdn.example/${encodeURIComponent(name)}.jpg`],
    offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' },
  })}</script></head><body></body></html>`
}

// Nuvemshop: catálogo dirigido exclusivamente pelas URLs de produto do sitemap.
{
  const calls = []
  const request = async (input) => {
    const url = String(input); calls.push(url)
    if (url === 'https://demo.lojavirtualnuvem.com.br/') return response(url, '<html>Nuvemshop</html>')
    if (url === 'https://demo.lojavirtualnuvem.com.br/sitemap.xml') return response(url, `<?xml version="1.0"?><urlset>
      <url><loc>https://demo.lojavirtualnuvem.com.br/</loc></url>
      <url><loc>https://demo.lojavirtualnuvem.com.br/produtos/vestido-azul/</loc></url>
      <url><loc>https://demo.lojavirtualnuvem.com.br/produtos/calca-preta/</loc></url>
      <url><loc>https://demo.lojavirtualnuvem.com.br/categorias/feminino/</loc></url>
    </urlset>`, 'application/xml')
    if (url.includes('/produtos/vestido-azul')) return response(url, productHtml('Vestido Azul', 89.9, 'VA-1'))
    if (url.includes('/produtos/calca-preta')) return response(url, productHtml('Calça Preta', 119.9, 'CP-1'))
    throw new Error(`unexpected nuvemshop URL ${url}`)
  }
  const result = await collectCatalog('https://demo.lojavirtualnuvem.com.br/', { request, strictPlatformAdapters: true })
  assert.equal(result.platform, 'nuvemshop')
  assert.equal(result.candidateCount, 2)
  assert.deepEqual(result.candidates.map((p) => p.sku).sort(), ['CP-1', 'VA-1'])
  assert.ok(!calls.some((url) => url.includes('/categorias/feminino')))
  assert.ok(calls.length <= 4)
}

// Loja Integrada: segue apenas sitemap/product-*.xml, sem explodir em marca/categoria/páginas auxiliares.
{
  const calls = []
  const request = async (input) => {
    const url = String(input); calls.push(url)
    if (url === 'https://demo.lojaintegrada.com.br/') return response(url, '<html>cdn.awsli.com.br lojaintegrada</html>')
    if (url === 'https://demo.lojaintegrada.com.br/sitemap.xml') return response(url, `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://demo.lojaintegrada.com.br/sitemap/product-1.xml</loc></sitemap>
      <sitemap><loc>https://demo.lojaintegrada.com.br/sitemap/category-1.xml</loc></sitemap>
      <sitemap><loc>https://demo.lojaintegrada.com.br/sitemap/brand-1.xml</loc></sitemap>
    </sitemapindex>`, 'application/xml')
    if (url === 'https://demo.lojaintegrada.com.br/sitemap/product-1.xml') return response(url, `<?xml version="1.0"?><urlset>
      <url><loc>https://demo.lojaintegrada.com.br/produto-a</loc></url>
      <url><loc>https://demo.lojaintegrada.com.br/produto-b</loc></url>
    </urlset>`, 'application/xml')
    if (url.endsWith('/produto-a')) return response(url, productHtml('Produto A', 10, 'LI-A'))
    if (url.endsWith('/produto-b')) return response(url, productHtml('Produto B', 20, 'LI-B'))
    throw new Error(`unexpected loja integrada URL ${url}`)
  }
  const result = await collectCatalog('https://demo.lojaintegrada.com.br/', { request, strictPlatformAdapters: true })
  assert.equal(result.platform, 'lojaintegrada')
  assert.equal(result.candidateCount, 2)
  assert.ok(!calls.some((url) => url.includes('category-1.xml') || url.includes('brand-1.xml')))
  assert.ok(calls.length <= 5)
}

// Tray: web_api pública paginada + grade/SKU das variantes públicas.
{
  const request = async (input) => {
    const url = String(input)
    if (url === 'https://demo.commercesuite.com.br/') return response(url, '<html>Tecnologia Tray</html>')
    const parsed = new URL(url)
    if (parsed.pathname === '/web_api/products') return response(url, JSON.stringify({
      paging: { total: 2, page: 1, limit: 50 },
      Products: [
        { Product: { id: '1', name: 'Camiseta', reference: 'CAM-1', price: '79.90', available: '1', available_for_purchase: '1', brand: 'Marca A', url: { https: 'https://demo.commercesuite.com.br/camiseta' }, ProductImage: [{ https: 'https://cdn.tray/cam.jpg' }] } },
        { Product: { id: '2', name: 'Short', reference: 'SH-1', price: '59.90', available: '1', available_for_purchase: '1', url: { https: 'https://demo.commercesuite.com.br/short' }, ProductImage: [] } },
      ],
    }), 'application/json')
    if (parsed.pathname === '/web_api/variants') return response(url, JSON.stringify({
      paging: { total: 2, page: 1, limit: 50 },
      Variants: [
        { Variant: { id: '10', product_id: '1', reference: 'CAM-P-AZ', price: '79.90', stock: '5', Sku: [{ type: 'Cor', value: 'Azul' }, { type: 'Tamanho', value: 'P' }] } },
        { Variant: { id: '11', product_id: '1', reference: 'CAM-M-PT', price: '79.90', stock: '3', Sku: [{ type: 'Cor', value: 'Preto' }, { type: 'Tamanho', value: 'M' }] } },
      ],
    }), 'application/json')
    throw new Error(`unexpected tray URL ${url}`)
  }
  const result = await collectCatalog('https://demo.commercesuite.com.br/', { request, strictPlatformAdapters: true })
  assert.equal(result.platform, 'tray')
  assert.equal(result.candidateCount, 2)
  assert.equal(result.candidates[0].variants.length, 2)
  assert.equal(result.candidates[0].variants[0].sku, 'CAM-P-AZ')
  assert.deepEqual(result.candidates[0].properties.find((p) => p.name === 'Cor').values.sort(), ['Azul', 'Preto'])
  assert.deepEqual(result.candidates[0].properties.find((p) => p.name === 'Tamanho').values.sort(), ['M', 'P'])
}

// Vesti: identifica UUID da empresa e enriquece a listagem com stocks = combinações reais cor/tamanho/SKU.
{
  const companyId = '7dc0202f-fbf4-4037-8882-6884199282bd'
  const rootHtml = `<html><script>self.__next_f.push([1,"x:\\"company\\":{\\"id\\":\\"${companyId}\\"}"])</script></html>`
  assert.equal(parseVestiCompanyId(rootHtml), companyId)
  let detailCalled = false
  const request = async (input) => {
    const url = String(input)
    if (url === 'https://v.vesti.mobi/lojax/catalogo/cat123') return response(url, rootHtml)
    if (url.startsWith('https://apivesti.vesti.mobi/appmarca/v2/catalogue/')) return response(url, JSON.stringify({
      products: [{ id: 'p1', code: 'V-1', name: 'Pantalona', slug: 'pantalona', price: 59.9, media: { normal: { url: 'https://cdn.vesti/list.jpg' } }, colors: [{ id: 'c1', name: 'Azul' }] }],
      links: { next: null },
      meta: { current_page: 1 },
    }), 'application/json')
    if (url.includes(`/appmarca/v1/products/company/${companyId}/product/p1/showcase`)) {
      detailCalled = true
      return response(url, JSON.stringify({ product_group: {
        id: 'p1', code: 'V-1', name: 'Pantalona', description: 'Alfaiataria', price: 59.9,
        media: [{ normal: { url: 'https://cdn.vesti/detail-1.jpg' } }, { normal: { url: 'https://cdn.vesti/detail-2.jpg' } }],
        colors: [{ id: 'c1', name: 'Azul' }, { id: 'c2', name: 'Preto' }],
        sizes: [{ id: 's1', name: 'P' }, { id: 's2', name: 'M' }],
        stocks: [
          { id: 'st1', sku: 'V-1-AZ-P', color_id: 'c1', size_id: 's1', quantity: 4, sell: true, price: 59.9 },
          { id: 'st2', sku: 'V-1-PT-M', color_id: 'c2', size_id: 's2', quantity: 2, sell: true, price: 59.9 },
        ],
      } }), 'application/json')
    }
    throw new Error(`unexpected vesti URL ${url}`)
  }
  const result = await collectCatalog('https://v.vesti.mobi/lojax/catalogo/cat123', { request, strictPlatformAdapters: true })
  assert.equal(result.platform, 'vesti')
  assert.equal(result.candidateCount, 1)
  assert.equal(detailCalled, true)
  assert.equal(result.candidates[0].source, 'vesti-public-api-detail')
  assert.equal(result.candidates[0].variants.length, 2)
  assert.deepEqual(result.candidates[0].properties.find((p) => p.name === 'Cor').values, ['Azul', 'Preto'])
  assert.deepEqual(result.candidates[0].properties.find((p) => p.name === 'Tamanho').values, ['P', 'M'])
  assert.deepEqual(result.candidates[0].images, ['https://cdn.vesti/detail-1.jpg', 'https://cdn.vesti/detail-2.jpg'])
}

console.log('[scanner module 7] dedicated collectors: ok')
