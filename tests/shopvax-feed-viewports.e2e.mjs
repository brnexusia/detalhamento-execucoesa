import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const sizes = [[320,568],[390,844],[430,932],[768,700],[1024,768],[1440,900]]
const browser = await chromium.launch({ headless: true })
const posts = Array.from({ length: 24 }, (_, i) => ({
  id: `viewport-post-${i}`,
  product: { id: `viewport-product-${i}`, name: `Produto ${i}`, description: 'Teste responsivo',
    sku: `P-${i}`, category: 'Moda', price: 49.9, mediaUrl: '', mediaType: 'image',
    variations: [], images: [], publishedAt: '2026-10-31T00:00:00Z' },
  store: { id: 'viewport-store', slug: 'viewport-store', name: 'Loja Teste',
    logoUrl: '', accent: '#F25C05', planTier: 'bronze' },
  interactions: { views: 0, likes: 0, shares: 0, followers: 0, liked: false, following: false },
}))
const results = []
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 768,
      hasTouch: width < 768,
      deviceScaleFactor: width < 768 ? 2 : 1,
    })
    const page = await context.newPage()
    await page.route('**/api/social/feed?**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ posts, page: { hasMore: false, nextCursor: null } }),
    }))
    await page.route('**/api/social/posts/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ views: 1 }),
    }))
    await page.goto('http://127.0.0.1:5173/feed')
    await page.locator('.social-feed-card').first().waitFor()
    for (let index = 1; index <= 8; index++) {
      await page.locator('.social-feed-list').evaluate(async (list, target) => {
        list.scrollTop = target * list.clientHeight
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, index)
    }
    const state = await page.locator('.social-feed-list').evaluate(list => ({
      cards: list.querySelectorAll('.social-feed-card').length,
      height: list.clientHeight,
      scrollScreens: list.scrollTop / Math.max(1, list.clientHeight),
      snap: getComputedStyle(list).scrollSnapType,
      visibleNames: Array.from(list.querySelectorAll('.social-feed-card h2')).map(el => el.textContent),
    }))
    assert(state.cards > 0 && state.cards <= 6, `Janela inválida em ${width}px: ${state.cards}`)
    assert(state.snap.includes('mandatory'), `Scroll snap removido em ${width}px: ${state.snap}`)
    assert(state.scrollScreens >= 7, `Posição avançada perdida em ${width}px: ${state.scrollScreens}`)
    results.push({ width, height, ...state })
    if (width === 390) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:185, y:600 }] })
      await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:185, y:450 }] })
      await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:185, y:220 }] })
      await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] })
      await page.waitForTimeout(250)
      assert((await page.locator('.social-feed-card').count()) <= 6, 'Toque móvel rompeu a janela virtual')
    }
    await context.close()
  }
  console.log('SHOPVAX_PUBLIC_FEED_VIEWPORTS_OK', JSON.stringify(results))
} finally {
  await browser.close()
}
