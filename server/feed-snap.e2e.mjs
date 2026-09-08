import fs from 'node:fs'
import { chromium, devices } from '@playwright/test'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000'
const browserPath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => fs.existsSync(candidate))
if (!browserPath) throw new Error('Chrome/Chromium do runner não encontrado para validar o scroll snap em navegador real.')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

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

const iphone = devices['iPhone 13']
const browser = await chromium.launch({ headless: true, executablePath: browserPath, args: ['--no-sandbox'] })
try {
  const context = await browser.newContext({
    viewport: iphone.viewport,
    userAgent: iphone.userAgent,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()

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
  await page.waitForFunction(() => document.querySelectorAll('.social-feed-card').length === 3, null, { timeout: 5000 })

  const sizes = await page.locator('.social-feed-list').evaluate((element) => ({
    listHeight: element.getBoundingClientRect().height,
    cardHeights: Array.from(element.querySelectorAll('.social-feed-card')).map((card) => card.getBoundingClientRect().height),
  }))
  assert(sizes.listHeight > 500, `Viewport do feed inválido: ${sizes.listHeight}px.`)
  for (const height of sizes.cardHeights) assert(Math.abs(height - sizes.listHeight) <= 1, `Card com ${height}px difere do viewport ${sizes.listHeight}px.`)

  await page.locator('.social-feed-list').evaluate((element) => {
    element.scrollTop = element.clientHeight * 0.62
    element.dispatchEvent(new Event('scroll'))
  })

  await page.waitForFunction(() => {
    const element = document.querySelector('.social-feed-list')
    return element instanceof HTMLElement && Math.abs(element.scrollTop - element.clientHeight) <= 2
  }, null, { timeout: 2500 })

  const aligned = await page.locator('.social-feed-list').evaluate((element) => {
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
  assert(aligned, 'Segundo card não encontrado após o gesto de rolagem.')
  assert(aligned.topDelta <= 2, `Topo do card não encaixou: delta ${aligned.topDelta}px.`)
  assert(aligned.bottomDelta <= 2, `Rodapé do card não encaixou: delta ${aligned.bottomDelta}px.`)
  assert(Math.abs(aligned.scrollTop - aligned.viewport) <= 2, `Scroll parou entre publicações: ${aligned.scrollTop}/${aligned.viewport}.`)

  await page.setViewportSize({ width: 390, height: 760 })
  await page.waitForTimeout(180)

  const resized = await page.locator('.social-feed-list').evaluate((element) => {
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
  assert(resized, 'Card ativo desapareceu após alteração do viewport móvel.')
  assert(Math.abs(resized.cardHeight - resized.listHeight) <= 1, `Resize deixou card ${resized.cardHeight}px e viewport ${resized.listHeight}px.`)
  assert(resized.topDelta <= 2 && resized.bottomDelta <= 2, `Resize perdeu o encaixe do card: top=${resized.topDelta}, bottom=${resized.bottomDelta}.`)

  await context.close()
  console.log('[feed snap e2e] mobile browser runtime: ok')
} finally {
  await browser.close()
}
