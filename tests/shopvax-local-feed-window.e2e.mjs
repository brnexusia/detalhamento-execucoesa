import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const products = Array.from({ length: 220 }, (_, i) => ({
  id: `p-${i}`, sku: `sku-${i}`, name: `Peça ${i}`, description: 'Produto teste',
  price: 39.9, category: 'Moda', mediaType: 'image', mediaUrl: '', images: [],
  variations: [], stockQuantity: 100,
}))
const payload = {
  store: { slug: 'stress-publico', name: 'Loja de teste', minimumOrder: 0, accent: '#F25C05', whatsapp: '5571999999999' },
  seller: { slug: 'ana', name: 'Ana', phone: '5571999999999' },
  products, categories: ['Moda'], page: { hasMore: false, nextCursor: null },
}
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/api/public/store/stress-publico**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }))
  await page.route('**/api/public/events', route => route.fulfill({ status: 204, body: '' }))
  await page.goto('http://127.0.0.1:5173/stress-publico')
  await page.locator('.product-card').first().waitFor()
  await page.getByRole('button', { name: 'Passar uma por uma' }).click()
  await page.locator('.feed-card').first().waitFor()
  assert((await page.locator('.feed-card').count()) <= 6, 'Feed da loja não possui janela limitada')
  for (let i = 1; i <= 140; i++) {
    await page.locator('.feed-list').evaluate(async (list, index) => {
      list.scrollTop = index * list.clientHeight
      await new Promise(resolve => requestAnimationFrame(resolve))
    }, i)
  }
  const metrics = await page.locator('.feed-list').evaluate(list => ({
    cards: list.querySelectorAll('.feed-card').length,
    nodes: list.querySelectorAll('*').length,
    position: list.scrollTop / Math.max(1, list.clientHeight),
  }))
  assert(metrics.cards <= 6, `140 transições renderizaram ${metrics.cards} cards`)
  assert(metrics.position >= 125, `Scroll perdeu o item ativo: ${metrics.position}`)
  await page.locator('.feed-card button[aria-label^="Montar grade de"]').last().click()
  await page.locator('.picker-layer').waitFor()
  console.log('SHOPVAX_LOCAL_FEED_PERFORMANCE', JSON.stringify(metrics))
} finally {
  await browser.close()
}
