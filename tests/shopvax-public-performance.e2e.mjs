import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'

const mode = process.argv.includes('--baseline') ? 'baseline' : 'candidate'
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5173'
const outputDir = process.env.PERF_OUTPUT_DIR || 'artifacts/shopvax-public-performance'
const totalPosts = 240
const transitions = 200
const network = process.env.PERF_NETWORK || '4g'
const makePost = (index) => ({
  id: `post-${index}`,
  product: { id: `product-${index}`, sku: `SKU-${index}`, name: `Produto ${String(index).padStart(4, '0')}`,
    description: 'Peça de demonstração para benchmark controlado.', price: 59.9, category: 'Roupas',
    mediaUrl: '', mediaType: 'image', images: [], variations: [], publishedAt: '2026-10-30T12:00:00Z' },
  store: { id: 'store-1', slug: 'loja-teste', name: 'Loja Teste', logoUrl: '', accent: '#F25C05', planTier: 'bronze' },
  interactions: { views: 0, likes: 0, shares: 0, followers: 0, liked: false, following: false },
})
const posts = Array.from({ length: totalPosts }, (_, i) => makePost(i + 1))
const mockBody = JSON.stringify({ posts, page: { hasMore: false, nextCursor: null } })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await context.addInitScript(() => {
  window.__shopvaxPerf = { lcp: null, cls: 0 }
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__shopvaxPerf.lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shopvaxPerf.cls += entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  } catch { /* unavailable browser metric */ }
})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Performance.enable')
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
const profile = network === 'slow3g'
  ? { latency: 400, downloadThroughput: 400_000 / 8, uploadThroughput: 400_000 / 8 }
  : { latency: 120, downloadThroughput: 4_000_000 / 8, uploadThroughput: 1_000_000 / 8 }
await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile })
await page.route('**/api/social/feed?**', route => route.fulfill({
  status: 200, contentType: 'application/json', body: mockBody,
}))
await page.route('**/api/social/posts/**', route => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ views: 1 }),
}))
const samples = []
async function sample(stage) {
  const dom = await page.evaluate(() => {
    const list = document.querySelector('.social-feed-list')
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    const perf = window.__shopvaxPerf || {}
    return {
      cards: document.querySelectorAll('.social-feed-card').length,
      feedNodes: list?.querySelectorAll('*').length || 0,
      scrollTop: list?.scrollTop || 0,
      viewport: list?.clientHeight || 0,
      sessionBytes: (sessionStorage.getItem('shopvax_social_feed_state_v3') || '').length,
      firstPieceMs: Number(performance.now().toFixed(1)),
      ttfbMs: nav ? Number((nav.responseStart - nav.requestStart).toFixed(1)) : null,
      lcpMs: perf.lcp ?? null,
      cls: perf.cls ?? null,
      resourceTransferBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
    }
  })
  const metrics = await cdp.send('Performance.getMetrics')
  const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? null
  samples.push({ stage, ...dom, jsHeapBytes: metric('JSHeapUsedSize'), totalDomNodes: metric('Nodes') })
}
try {
  await page.goto(`${baseUrl}/feed`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.locator('.social-feed-card').first().waitFor({ timeout: 90_000 })
  await sample('initial')
  const swipeTimes = []
  for (let i = 1; i <= transitions; i++) {
    const paintMs = await page.locator('.social-feed-list').evaluate(async (list, number) => {
      const start = performance.now()
      list.scrollTop = number * list.clientHeight
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return performance.now() - start
    }, i)
    swipeTimes.push(paintMs)
    if (i === 50 || i === 100 || i === 200) await sample(`swipe-${i}`)
  }
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await sample('session-persisted')
  const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('shopvax_social_feed_state_v3') || 'null'))
  if (mode === 'candidate') assert.equal(session?.posts?.length, totalPosts, 'Retorno ao feed não deve perder publicações já carregadas dentro do teto de cache')
  const last = samples.at(-1)
  if (mode === 'candidate') {
    assert(last.cards <= 6, `Feed mantém ${last.cards} cards; a janela deve ter no máximo seis`)
    assert(last.sessionBytes <= 750_000, `Cache da sessão ultrapassou o orçamento: ${last.sessionBytes}`)
  }
  const countBefore = await page.evaluate(() => {
    const key = 'shopvax-cart-v1:loja-teste'
    return JSON.parse(localStorage.getItem(key) || '[]').length
  })
  const addButton = page.locator('.social-feed-card .social-feed-add').last()
  await addButton.click()
  const countAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('shopvax-cart-v1:loja-teste') || '[]').length)
  assert.equal(countAfter, countBefore + 1, 'Montar pedido precisa manter gravação do carrinho')
  const beforeNavigation = await page.locator('.social-feed-list').evaluate((list) =>
    list.scrollTop / Math.max(1, list.clientHeight))
  if (mode === 'candidate') {
    assert(beforeNavigation >= 180, `A janela virtual perdeu o scroll ANTES da navegação: ${beforeNavigation}`)
  }
  const activeName = await page.locator('.social-feed-card h2').last().innerText()
  const firstIndex = Number(activeName.replace(/\D/g, ''))
  fs.mkdirSync(outputDir, { recursive: true })
  await page.screenshot({ path: `${outputDir}/${mode}-${network}-before-profile.png` })
  await page.locator('.social-feed-store').last().click()
  await page.waitForURL('**/perfil/loja-teste')
  const profileSession = await page.evaluate(() => {
    const cache = JSON.parse(sessionStorage.getItem('shopvax_social_feed_state_v3') || 'null')
    return { scrollTop: cache?.scrollTop, activePostId: cache?.activePostId,
      posts: cache?.posts?.length, savedAt: cache?.savedAt }
  })
  console.log('SHOPVAX_PROFILE_SESSION', JSON.stringify(profileSession))
  if (mode === 'candidate') {
    assert(profileSession.scrollTop / 844 >= 180,
      `Ao abrir o perfil, sessão já perdeu a posição avançada: ${JSON.stringify(profileSession)}`)
    assert(profileSession.activePostId?.startsWith('post-'),
      'Sessão deve preservar identidade estável da publicação')
  }
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.locator('.social-feed-card').first().waitFor({ timeout: 20000 })
  if (mode === 'candidate') {
    try {
      await page.waitForFunction(() => {
        const list = document.querySelector('.social-feed-list')
        const anchor = window.history.state?.shopvaxFeedPosition?.postId
        return Boolean(list && anchor && list.scrollTop / Math.max(1, list.clientHeight) >= 180 &&
          list.querySelector(`[data-post-id="${anchor}"]`))
      }, null, { timeout: 10000 })
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const list = document.querySelector('.social-feed-list')
        const cached = JSON.parse(sessionStorage.getItem('shopvax_social_feed_state_v3') || 'null')
        return { url: location.href, state: history.state, scrollTop: list?.scrollTop,
          clientHeight: list?.clientHeight, scrollHeight: list?.scrollHeight,
          snap: list ? getComputedStyle(list).scrollSnapType : null,
          firstCard: list?.querySelector('.social-feed-card')?.getAttribute('data-post-id'),
          cardIds: Array.from(list?.querySelectorAll('.social-feed-card') || []).map(x => x.getAttribute('data-post-id')),
          cachedScroll: cached?.scrollTop, cachedAnchor: cached?.activePostId,
          cachedCount: cached?.posts?.length,
          feedDataset: list ? { ...list.dataset } : null,
          cacheNote: Boolean(document.querySelector('.social-feed-cache-note')) }
      })
      fs.writeFileSync(`${outputDir}/${mode}-${network}-restore-failure.json`, JSON.stringify(diagnostics, null, 2))
      await page.screenshot({ path: `${outputDir}/${mode}-${network}-restore-failure.png` })
      console.error('SHOPVAX_RESTORE_DIAGNOSTICS', JSON.stringify(diagnostics))
      throw error
    }
  }
  await page.screenshot({ path: `${outputDir}/${mode}-${network}-restored.png` })
  const returnPosition = await page.locator('.social-feed-list').evaluate((list) => list.scrollTop / Math.max(1, list.clientHeight))
  if (mode === 'candidate') {
    assert(returnPosition >= 180, `Navegação de volta perdeu posição: ${returnPosition}`)
  }
  const sorted = swipeTimes.slice().sort((a, b) => a - b)
  const report = {
    mode, network, environment: 'GitHub Actions Linux / Chromium / viewport 390x844 / CPU throttled 4x',
    fixture: '240 publicações sintéticas; API mockada, sem PostgreSQL, sem mídias reais',
    transitions, apiPayloadBytes: Buffer.byteLength(mockBody),
    samples, swipeToTwoFramesP50Ms: sorted[Math.floor(sorted.length * .5)],
    swipeToTwoFramesP95Ms: sorted[Math.floor(sorted.length * .95)],
    restoredPositionInScreens: returnPosition,
    restoredPostId: await page.evaluate(() => document.querySelector('.social-feed-card[data-post-id="' + window.history.state?.shopvaxFeedPosition?.postId + '"]')?.getAttribute('data-post-id') || null),
    cartPersisted: countAfter === countBefore + 1, activeName, firstIndex,
    warning: 'TTFB/LCP/CLS e bytes são de laboratório com Vite e mock; não representam produção. INP real, memória Safari iOS e bateria não foram medidos.',
  }
  fs.mkdirSync(outputDir, { recursive: true })
  await page.screenshot({ path: `${outputDir}/${mode}-${network}.png` })
  fs.writeFileSync(`${outputDir}/${mode}-${network}.json`, JSON.stringify(report, null, 2))
  console.log('SHOPVAX_PUBLIC_PERFORMANCE', JSON.stringify(report))
} finally {
  await browser.close()
}
