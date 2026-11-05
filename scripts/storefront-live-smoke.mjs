import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = 'https://shopvax.com.br'
// Discover currently active public stores rather than pinning removed or suspended slugs.
const sitemapResponse = await fetch(origin + '/sitemap-stores-1.xml', {
  headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
})
assert.equal(sitemapResponse.status, 200, 'Public store sitemap must be available')
const sitemap = await sitemapResponse.text()
const activeSlugs = [...sitemap.matchAll(/<loc>https:\/\/shopvax\.com\.br\/([a-z0-9-]+)<\/loc>/g)].map((match) => match[1])
assert.ok(activeSlugs.includes('lookpremium'), 'Look Premium must be in the active public sitemap')
const slugs = ['lookpremium', ...activeSlugs.filter(slug => slug !== 'lookpremium').slice(0, 2)]
assert.equal(slugs.length, 3, 'Need at least 3 active public storefronts for live smoke')

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
let errors = 0
try {
  for (const slug of slugs) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()
    const jsErrors = []
    const publicRequests = []
    page.on('pageerror', error => jsErrors.push(String(error.message).slice(0, 140)))
    page.on('response', response => {
      if (response.url().includes('/api/public/store/' + slug)) {
        publicRequests.push({ code: response.status(), path: new URL(response.url()).pathname })
      }
    })
    page.on('requestfailed', request => {
      if (request.url().includes('/api/public/store/' + slug)) {
        publicRequests.push({ code: 'failed', reason: String(request.failure()?.errorText || '').slice(0, 100) })
      }
    })
    try {
      const response = await page.goto(origin + '/' + slug, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.locator('.store-intro__identity h1').waitFor({ timeout: 25000 })
      const result = await page.evaluate(() => ({
        name: document.querySelector('.store-intro__identity h1')?.textContent?.trim() || '',
        productCards: document.querySelectorAll('.svx-discovery__rail button').length,
        errorText: document.body.innerText.includes('Não foi possível abrir a loja agora'),
      }))
      const ok = response?.status() === 200 && Boolean(result.name) &&
        !result.errorText && publicRequests.some(x => x.code === 200) &&
        (slug !== 'lookpremium' || result.productCards > 0)
      console.log(JSON.stringify({ slug, pageStatus: response?.status(), jsErrors: jsErrors.slice(0, 4), publicRequests, productCards: result.productCards, loadedStoreName: Boolean(result.name), failureMessage: result.errorText, ok }))
      if (!ok) errors++
    } catch (error) {
      console.log(JSON.stringify({ slug, browserError: String(error.message).slice(0, 250), jsErrors: jsErrors.slice(0, 4), publicRequests }))
      errors++
    } finally { await context.close() }
  }
} finally {
  await browser.close()
}
assert.equal(errors, 0, 'At least one live public storefront failed JavaScript rendering with Googlebot UA')
