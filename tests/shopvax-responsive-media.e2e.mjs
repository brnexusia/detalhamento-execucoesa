import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const payload = {
  store: { slug: 'fotos-teste', name: 'FOTOS TESTE', minimumOrder: 0, accent: '#F25C05', whatsapp: '5571999999999' },
  seller: { slug: 'ana', name: 'Ana', phone: '5571999999999' },
  categories: ['Roupas'], page: { hasMore: false, nextCursor: null },
  products: [
    { id: 'local', sku: 'F-01', name: 'Foto local', description: 'Imagem leve', price: 39.90, category: 'Roupas', mediaUrl: '/media/asset-local', mediaType: 'image', images: [], variations: [] },
    { id: 'external', sku: 'F-02', name: 'Foto externa', description: 'Imagem externa', price: 39.90, category: 'Roupas', mediaUrl: 'https://example.com/image.jpg', mediaType: 'image', images: [], variations: [] },
  ],
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wg8va0AAAAASUVORK5CYII=', 'base64')
  await page.route('**/media/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: pixel }))
  await page.route('https://example.com/image.jpg', route => route.fulfill({ status: 200, contentType: 'image/png', body: pixel }))
  await page.route('**/api/public/store/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }))
  await page.route('**/api/public/events', route => route.fulfill({ status: 204, body: '' }))
  await page.goto('http://127.0.0.1:5173/fotos-teste')
  const images = page.locator('.product-card__media img')
  await images.first().waitFor()
  const srcsets = await images.evaluateAll(elements => elements.map(img => ({ src: img.getAttribute('src'), srcset: img.getAttribute('srcset') })))
  const local = srcsets.find(item => item.src === '/media/asset-local')
  const external = srcsets.find(item => item.src === 'https://example.com/image.jpg')
  assert(local, 'Foto local do catálogo não foi renderizada')
  assert.match(local.srcset || '', /\/media\/asset-local\?w=320 320w/)
  assert.match(local.srcset || '', /\/media\/asset-local\?w=960 960w/)
  assert(external, 'Foto externa da loja não foi renderizada')
  assert.equal(external.srcset, null, 'Não inventar variantes em URLs externas')
} finally {
  await browser.close()
}
console.log('SHOPVAX_RESPONSIVE_MEDIA_OK')
