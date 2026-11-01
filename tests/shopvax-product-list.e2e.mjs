import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const product = (id, name, category, price, active = true) => ({
  id, sku: 'REF-' + id, name, description: 'Peça cadastrada', category, price,
  media_url: '', media_type: 'image', images: [], variant_images: [], pack: '',
  variations: [], featured: id === '01', active, stock_enabled: false,
  stock_quantity: 0, variant_stock: {},
})
const products = [
  product('01', 'Blusa Grená', 'Blusas', 59.9),
  product('02', 'Calça Preta', 'Calças', 109.9),
  product('03', 'Blusa Azul', 'Blusas', 69.9),
  ...Array.from({ length: 19 }, (_, index) => product(String(index + 4).padStart(2, '0'), 'Peça ' + (index + 4), 'Acessórios', 24.9, index !== 0)),
]
const data = {
  user: { id: 'u1', email: 'loja@example.test', name: 'Ana Teste' },
  store: {
    id: 's1', slug: 'sw-moda', name: 'SW Moda', eyebrow: 'Atacado', tagline: 'Coleção',
    minimum_order: 0, whatsapp: '5571999999999', logo_url: '', accent: '#F25C05',
    is_active: true, plan_tier: 'prata', onboarding_palette_selected: true,
  },
  sellers: [], orders: [], stats: { views: 0, carts: 0, orders: 0, value: 0 },
}
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
    // Each viewport starts with identical, isolated API data.
    const items = products.map((item) => ({ ...item }))
    const page = await browser.newPage({ viewport: { width, height } })
    await page.route('**/api/admin/bootstrap*', (route) => {
      const categories = [...new Set(items.map((item) => item.category))]
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ...data, products: [], productCount: items.length,
          activeProductCount: items.filter((item) => item.active).length,
          productCategories: categories.map((category) => ({
            category, count: items.filter((item) => item.category === category).length,
          })),
        }),
      })
    })
    await page.route('**/api/admin/products?*', (route) => {
      const url = new URL(route.request().url())
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const category = url.searchParams.get('category') || 'Todas'
      const limit = Number(url.searchParams.get('limit') || 18)
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const filtered = items.filter((item) =>
        (category === 'Todas' || item.category === category) &&
        [item.name, item.sku, item.category].join(' ').toLowerCase().includes(q))
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          products: filtered.slice((pageNumber - 1) * limit, pageNumber * limit),
          pagination: { page: pageNumber, limit, total: filtered.length },
        }),
      })
    })
    await page.route('**/api/admin/products/*/visibility', (route) => {
      const id = route.request().url().split('/').at(-2)
      const item = items.find((entry) => entry.id === id)
      if (!item) return route.fulfill({ status: 404 })
      item.active = Boolean(route.request().postDataJSON().active)
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ product: { id, active: item.active } }) })
    })
    await page.route('**/api/admin/imports*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [] }),
    }))
    await page.goto('http://127.0.0.1:5173/painel/produtos')
    await page.locator('.svx-products .product-admin-card').first().waitFor()
    assert.equal(await page.locator('.svx-products .product-admin-card').count(), 18)

    // Real columns, visible-product count and importer portal in the correct header.
    assert.equal(await page.getByRole('columnheader').count(), 6)
    assert.match(await page.locator('.svx-products__eyebrow').innerText(), /21 APARECEM NA LOJA/)
    await page.getByRole('button', { name: 'Importar catálogo' }).waitFor()
    assert.equal(await page.locator('.svx-products__top-actions .scanner-entry-button').count(), 1)
    assert.equal(await page.locator('.svx-products__featured').count(), 1)

    // Load more accumulates pages instead of replacing the first page.
    await page.getByRole('button', { name: 'Ver mais produtos' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 22)
    assert.match(await page.locator('.svx-products__footer').innerText(), /22 DE 22 PRODUTOS/)

    // Category filter, debounced search and bulk selection still work on every viewport.
    await page.locator('.svx-products__categories button').filter({ hasText: 'Blusas' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 2)
    await page.locator('.svx-products__search input').fill('Azul')
    await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 1)
    await page.locator('.svx-products__search input').fill('')
    await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-admin-card').length === 2)
    await page.getByRole('button', { name: 'Selecionar produtos' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.svx-products .product-select-control input').length === 2)
    await page.getByRole('button', { name: 'Cancelar seleção' }).click()

    // Accessible switch updates through the real visibility API path.
    const visibility = page.getByRole('switch', { name: /Ocultar Blusa Grená/ })
    assert.equal(await visibility.getAttribute('aria-checked'), 'true')
    await visibility.click()
    await page.waitForFunction(() => {
      const node = [...document.querySelectorAll('[role="switch"]')].find((item) => item.getAttribute('aria-label')?.includes('Blusa Grená'))
      return node?.getAttribute('aria-checked') === 'false'
    })

    // Preserve import and edit actions; never lose them during a visual refactor.
    await page.getByRole('button', { name: 'Importar catálogo' }).click()
    await page.locator('.scanner-modal-layer').waitFor()
    await page.locator('.scanner-modal-backdrop').click({ position: { x: 3, y: 3 } })
    assert.equal(await page.locator('.svx-products__edit').count(), 2)
    console.log('PRODUCTS_EDITORIAL_PASS', width, height)
    await page.close()
  }
} finally {
  await browser.close()
}
console.log('PRODUCTS_EDITORIAL_TESTS_PASSED', 3)
