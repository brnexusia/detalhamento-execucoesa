import { devices, expect, test } from '@playwright/test'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000'
const iphone = devices['iPhone 13']

test.use({
  viewport: iphone.viewport,
  userAgent: iphone.userAgent,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: iphone.isMobile,
  hasTouch: iphone.hasTouch,
})

function post(id, name, price) {
  return {
    id,
    product: {
      id: `product-${id}`,
      sku: `SKU-${id}`,
      name,
      description: 'Descrição curta para validar o feed em uma tela por produto.',
      price,
      category: 'Teste',
      mediaUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22390%22 height=%22844%22%3E%3Crect width=%22390%22 height=%22844%22 fill=%22%23222428%22/%3E%3C/svg%3E',
      mediaType: 'image',
      variations: [],
      featured: false,
      publishedAt: new Date().toISOString(),
    },
    store: {
      id: 'store-test',
      slug: 'teste',
      name: 'Loja Teste',
      logoUrl: '',
      accent: '#c8ff38',
      planTier: 'bronze',
    },
    interactions: { views: 0, likes: 0, shares: 0, followers: 0, liked: false, following: false },
  }
}

test('feed mobile WebKit settles exactly one publication per viewport', async ({ page }) => {
  await page.route('**/api/social/feed?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        posts: [post('1', 'Produto 1', 10), post('2', 'Produto 2', 20), post('3', 'Produto 3', 30)],
        page: { hasMore: false, nextCursor: null },
      }),
    })
  })
  await page.route('**/api/social/posts/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ views: 1 }) })
  })

  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  const list = page.locator('.social-feed-list')
  const cards = page.locator('.social-feed-card')
  await expect(cards).toHaveCount(3)

  const sizes = await list.evaluate((element) => {
    const cardHeights = Array.from(element.querySelectorAll('.social-feed-card')).map((card) => card.getBoundingClientRect().height)
    return { listHeight: element.getBoundingClientRect().height, cardHeights }
  })
  expect(sizes.listHeight).toBeGreaterThan(500)
  for (const height of sizes.cardHeights) expect(Math.abs(height - sizes.listHeight)).toBeLessThanOrEqual(1)

  await list.evaluate((element) => {
    element.scrollTop = element.clientHeight * 0.62
    element.dispatchEvent(new Event('scroll'))
  })

  await page.waitForFunction(() => {
    const element = document.querySelector('.social-feed-list')
    if (!(element instanceof HTMLElement)) return false
    return Math.abs(element.scrollTop - element.clientHeight) <= 2
  }, null, { timeout: 2500 })

  const aligned = await list.evaluate((element) => {
    const card = element.querySelectorAll('.social-feed-card')[1]
    if (!(card instanceof HTMLElement)) return null
    const listRect = element.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return {
      topDelta: Math.abs(cardRect.top - listRect.top),
      bottomDelta: Math.abs(cardRect.bottom - listRect.bottom),
      scrollTop: element.scrollTop,
      viewport: element.clientHeight,
    }
  })
  expect(aligned).not.toBeNull()
  expect(aligned.topDelta).toBeLessThanOrEqual(2)
  expect(aligned.bottomDelta).toBeLessThanOrEqual(2)
  expect(Math.abs(aligned.scrollTop - aligned.viewport)).toBeLessThanOrEqual(2)

  await page.setViewportSize({ width: 390, height: 760 })
  await page.waitForTimeout(150)

  const resized = await list.evaluate((element) => {
    const card = element.querySelectorAll('.social-feed-card')[1]
    if (!(card instanceof HTMLElement)) return null
    const listRect = element.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return {
      listHeight: listRect.height,
      cardHeight: cardRect.height,
      topDelta: Math.abs(cardRect.top - listRect.top),
      bottomDelta: Math.abs(cardRect.bottom - listRect.bottom),
    }
  })
  expect(resized).not.toBeNull()
  expect(Math.abs(resized.cardHeight - resized.listHeight)).toBeLessThanOrEqual(1)
  expect(resized.topDelta).toBeLessThanOrEqual(2)
  expect(resized.bottomDelta).toBeLessThanOrEqual(2)
})
