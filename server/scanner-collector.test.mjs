import assert from 'node:assert/strict'
import { collectCatalog, detectPlatform, extractProductsFromHtml, extractSitemapLocations } from './scanner-collector.mjs'

assert.equal(detectPlatform('<script src="https://cdn.shopify.com/x.js"></script>'), 'shopify')
assert.equal(detectPlatform('<body class="woocommerce shop"></body>'), 'woocommerce')
assert.equal(detectPlatform('<script src="https://cdn.awsli.com.br/app.js"></script>'), 'lojaintegrada')
assert.equal(detectPlatform('<html></html>'), 'generic')

const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://fixture.shop/produto/a&amp;b</loc></url><url><loc>https://fixture.shop/produto/c</loc></url></urlset>`
assert.deepEqual(extractSitemapLocations(sitemap), ['https://fixture.shop/produto/a&b', 'https://fixture.shop/produto/c'])

const jsonLdHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Vestido Flora',
  description: 'Vestido midi leve',
  sku: 'VF-10',
  category: 'Vestidos',
  color: 'Azul',
  image: ['https://fixture.shop/flora-1.jpg', 'https://fixture.shop/flora-2.jpg'],
  offers: { '@type': 'Offer', price: '59.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' },
  hasVariant: [
    { '@type': 'Product', name: 'Vestido Flora P', sku: 'VF-10-P', size: 'P', color: 'Azul', offers: { price: '59.90', priceCurrency: 'BRL' } },
    { '@type': 'Product', name: 'Vestido Flora M', sku: 'VF-10-M', size: 'M', color: 'Azul', offers: { price: '59.90', priceCurrency: 'BRL' } },
  ],
})}</script></head><body></body></html>`
const extracted = extractProductsFromHtml(jsonLdHtml, 'https://fixture.shop/produto/flora')
assert.equal(extracted.length, 1)
assert.equal(extracted[0].title, 'Vestido Flora')
assert.equal(extracted[0].price, 59.9)
assert.equal(extracted[0].variants.length, 2)
assert.deepEqual(extracted[0].images, ['https://fixture.shop/flora-1.jpg', 'https://fixture.shop/flora-2.jpg'])

function fixtureRequest(fixtures) {
  return async (input) => {
    const url = String(input)
    const fixture = fixtures[url]
    if (!fixture) return { status: 404, ok: false, url, contentType: 'text/plain', headers: {}, body: '' }
    return { status: 200, ok: true, url, headers: {}, ...fixture }
  }
}

const genericFixtures = {
  'https://fixture.shop/': { contentType: 'text/html', body: '<html><body><a href="/produto/flora">Flora</a></body></html>' },
  'https://fixture.shop/robots.txt': { contentType: 'text/plain', body: 'Sitemap: https://fixture.shop/sitemap.xml' },
  'https://fixture.shop/sitemap.xml': { contentType: 'application/xml', body: '<urlset><url><loc>https://fixture.shop/produto/flora</loc></url><url><loc>https://fixture.shop/produto/bolsa</loc></url></urlset>' },
  'https://fixture.shop/produto/flora': { contentType: 'text/html', body: jsonLdHtml },
  'https://fixture.shop/produto/bolsa': { contentType: 'text/html', body: '<html><head><meta property="og:type" content="product"><meta property="og:title" content="Bolsa Siena"><meta property="og:description" content="Bolsa estruturada"><meta property="product:price:amount" content="48,90"><meta property="product:price:currency" content="BRL"><meta property="og:image" content="https://fixture.shop/siena.jpg"></head><body><h1>Bolsa Siena</h1><select name="Cor"><option>Selecione</option><option>Preto</option><option>Caramelo</option></select></body></html>' },
}

let progressCalls = 0
const generic = await collectCatalog('https://fixture.shop/', {
  request: fixtureRequest(genericFixtures),
  maxPages: 20,
  onProgress: async () => { progressCalls += 1 },
})
assert.equal(generic.platform, 'generic')
assert.equal(generic.candidates.length, 2)
assert.ok(generic.pagesScanned >= 4)
assert.ok(progressCalls >= 2)
assert.equal(generic.candidates.find((item) => item.title === 'Bolsa Siena')?.properties[0]?.name, 'Cor')

const shopifyRoot = '<html><script src="https://cdn.shopify.com/store.js"></script></html>'
const shopifyFixtures = {
  'https://shop.example/': { contentType: 'text/html', body: shopifyRoot },
  'https://shop.example/products.json?limit=250&page=1': { contentType: 'application/json', body: JSON.stringify({ products: [{ id: 7, title: 'Camisa Linho', handle: 'camisa-linho', body_html: '<p>Camisa ampla</p>', product_type: 'Camisas', vendor: 'Marca A', options: [{ name: 'Tamanho', values: ['P', 'M', 'G'] }], images: [{ src: 'https://shop.example/camisa.jpg' }], variants: [{ id: 71, title: 'P', sku: 'CL-P', price: '42.00', option1: 'P', available: true }] }] }) },
}
const shopify = await collectCatalog('https://shop.example/', { request: fixtureRequest(shopifyFixtures) })
assert.equal(shopify.platform, 'shopify')
assert.equal(shopify.candidates.length, 1)
assert.equal(shopify.candidates[0].sku, 'CL-P')
assert.equal(shopify.candidates[0].properties[0].values[2], 'G')

console.log('[scanner module 2] collector tests: ok')
