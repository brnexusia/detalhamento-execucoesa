import assert from 'node:assert/strict'
import { chromium } from 'playwright'

/**
 * Regressão visual dos dois ajustes solicitados no catálogo público:
 * (1) a fita de condições encosta nas duas bordas da vitrine;
 * (2) o contador permanece entre diminuir e aumentar, na mesma linha.
 *
 * Executar com a aplicação Vite disponível em http://127.0.0.1:5173.
 */
const photo = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700"><rect width="500" height="700" fill="#E7E3DA"/></svg>'
)
const product = {
  id: 'calca-milano',
  sku: 'MIL-001',
  name: 'CALÇA MILANO',
  description: '',
  price: 70,
  category: 'Calças',
  mediaType: 'image',
  mediaUrl: photo,
  images: [photo],
  variations: [],
}
const payload = {
  store: {
    slug: 'look-premium',
    name: 'Look Premium',
    eyebrow: 'Catálogo de atacado',
    minimumOrder: 400,
    whatsapp: '5571999999999',
    accent: '#F25C05',
  },
  seller: { slug: 'vendedora', name: 'Atendimento', phone: '5571999999999' },
  products: [product],
  categories: ['Calças'],
  page: { hasMore: false, nextCursor: null },
}
const browser = await chromium.launch({ headless: true })

try {
  for (const width of [320, 390, 700, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    try {
      await page.route('**/api/public/store/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
      )
      await page.goto('http://127.0.0.1:5173/look-premium')
      await page.locator('.store-intro.svx-vitrine .store-intro__ribbon').waitFor()

      const ribbon = await page.evaluate(() => {
        const rect = (selector) => {
          const node = document.querySelector(selector)
          assertElement(node, selector)
          const r = node.getBoundingClientRect()
          return { left: r.left, right: r.right, width: r.width }
        }
        function assertElement(node, selector) {
          if (!node) throw new Error('Missing element: ' + selector)
        }
        return {
          hero: rect('.store-intro.svx-vitrine'),
          tape: rect('.store-intro.svx-vitrine .store-intro__ribbon'),
          overflow: document.documentElement.scrollWidth - innerWidth,
        }
      })
      assert(Math.abs(ribbon.hero.left - ribbon.tape.left) <= 2,
        'A fita deixa lacuna à esquerda: ' + JSON.stringify({ width, ribbon }))
      assert(Math.abs(ribbon.hero.right - ribbon.tape.right) <= 2,
        'A fita deixa lacuna à direita: ' + JSON.stringify({ width, ribbon }))
      assert(ribbon.overflow <= 2, 'A fita criou scroll horizontal: ' + JSON.stringify({ width, ribbon }))

      await page.locator('.product-grid .product-card__media').first().click()
      await page.locator('.picker-quantity .quantity-control--large').waitFor()
      const quantity = await page.evaluate(() => {
        const control = document.querySelector('.picker-quantity .quantity-control--large')
        if (!control) throw new Error('Missing quantity control')
        const minus = control.querySelector('button:first-child')
        const number = control.querySelector('b')
        const plus = control.querySelector('button:last-child')
        if (!minus || !number || !plus) throw new Error('Missing quantity elements')
        const center = (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, height: r.height }
        }
        return {
          minus: center(minus),
          number: center(number),
          plus: center(plus),
          overflow: document.documentElement.scrollWidth - innerWidth,
        }
      })
      assert(quantity.minus.x < quantity.number.x && quantity.number.x < quantity.plus.x,
        'Quantidade não ficou entre - e +: ' + JSON.stringify({ width, quantity }))
      assert(Math.abs(quantity.minus.y - quantity.number.y) <= 2 &&
        Math.abs(quantity.number.y - quantity.plus.y) <= 2,
        'Os três elementos não estão na mesma linha: ' + JSON.stringify({ width, quantity }))
      assert(quantity.minus.height >= 44 && quantity.plus.height >= 44,
        'Áreas de toque devem ter ao menos 44px: ' + JSON.stringify({ width, quantity }))
      assert(quantity.overflow <= 2, 'Seletor criou scroll horizontal: ' + JSON.stringify({ width, quantity }))

      assert.equal(await page.locator('.picker-quantity .svx-motion-count').textContent(), '1')
      await page.getByRole('button', { name: 'Aumentar quantidade' }).click()
      assert.equal(await page.locator('.picker-quantity .svx-motion-count').textContent(), '2')
      assert.match(await page.locator('.picker-add__price').textContent(), /140,00/)
      await page.getByRole('button', { name: 'Diminuir quantidade' }).click()
      assert.equal(await page.locator('.picker-quantity .svx-motion-count').textContent(), '1')
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
console.log('SHOPVAX_STOREFRONT_QUANTITY_RIBBON_OK')
