import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

const browserType = process.env.SHOPVAX_TEST_BROWSER === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true })
const base = 'http://127.0.0.1:5173'
const stores = ['loja-a', 'loja-b', 'loja-c']
const names = { 'loja-a': 'Loja A', 'loja-b': 'Loja B', 'loja-c': 'Loja C' }
const product = slug => ({
  id: 'p-' + slug, sku: slug, name: 'Produto da ' + names[slug],
  description: 'Produto para testar isolamento.', category: 'Moda', price: 70,
  mediaUrl: '', mediaType: 'image', images: [], variations: [],
  publishedAt: '2026-11-01T00:00:00.000Z',
})
const store = slug => ({
  id: 's-' + slug, slug, name: names[slug], tagline: 'Catálogo ' + names[slug],
  eyebrow: 'Atacado', logoUrl: '', accent: '#f25c05', planTier: 'prata',
  productCount: 1, minimumOrder: 0, whatsapp: '5571999999999',
})
const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
})
const failures = []
try {
  for (const [width, height] of [[390, 844], [1366, 768]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    await context.route('**/api/public/store/**', route => {
      const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean)
      const slug = parts[3]
      if (!stores.includes(slug)) return json(route, { error: 'Loja desconhecida' }, 404)
      if (parts[4] === 'phase2-config') {
        return json(route, { store: store(slug), customerLoginEnabled: true,
          theme: { background: '#ffffff', textColor: '#161514', font: 'system' } })
      }
      if (parts[4] === 'customers' && parts[5] === 'me') return json(route, { error: 'Não autenticado' }, 401)
      return json(route, { store: store(slug), seller: {
        name: 'Vendedora ' + slug, slug: 'vendedora', phone: '5571999999999',
      }, products: [product(slug)], categories: ['Moda'],
      page: { hasMore: false, nextCursor: null, limit: 24 } })
    })
    await context.route('**/api/public/events', route => route.fulfill({ status: 204, body: '' }))
    await context.route('**/api/public/buyer-auth/me', route => json(route, { error: 'Não autenticado' }, 401))
    await context.route('**/api/social/stores/**', route => {
      const parts = new URL(route.request().url()).pathname.split('/').filter(Boolean)
      const slugOrId = parts[3]
      const slug = slugOrId.startsWith('s-') ? slugOrId.slice(2) : slugOrId
      if (!stores.includes(slug)) return json(route, { error: 'Loja desconhecida' }, 404)
      if (parts[4] === 'publications') {
        // Uma falha nas publicações da primeira loja não pode ocultar o perfil.
        return slug === 'loja-a' ? json(route, { error: 'Serviço temporariamente indisponível' }, 503) :
          json(route, { publications: [product(slug)] })
      }
      if (parts[4] === 'follow') return json(route, { code: 'AUTH_REQUIRED' }, 401)
      if (parts[4] === 'seller-route') return json(route, { seller: { slug: 'vendedora' } })
      return json(route, { store: store(slug), stats: { followers: 0, views: 0, following: false } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => failures.push(width + ': ' + error.message))
    await page.goto(base + '/loja-a')
    await page.locator('.store-intro h1').waitFor()
    assert.match(await page.locator('.store-intro h1').innerText(), /Loja A/)
    // O carrinho da Loja A precisa sobreviver a voltas, sem aparecer nas outras lojas.
    await page.evaluate(() => localStorage.setItem('shopvax-cart-v1:loja-a', JSON.stringify([{
      key: 'p-loja-a:', product: {
        id: 'p-loja-a', name: 'Produto da Loja A', price: 70,
        images: [], mediaUrl: '', variations: [],
      }, quantity: 3, selections: {},
    }])))
    await page.reload()
    await page.locator('.store-intro h1').waitFor()
    assert.equal(await page.locator('.cart-trigger b').innerText(), '3')
    for (const slug of ['loja-b', 'loja-c', 'loja-a']) {
      await page.evaluate(next => {
        history.pushState({}, '', '/' + next)
        dispatchEvent(new PopStateEvent('popstate'))
      }, slug)
      await page.locator('.store-intro h1').getByText(names[slug]).waitFor({ timeout: 10000 })
      assert.equal((await page.locator('.cart-trigger b').count()), slug === 'loja-a' ? 1 : 0,
        'Carrinho de outra loja apareceu em ' + slug)
      if (slug === 'loja-a') assert.equal(await page.locator('.cart-trigger b').innerText(), '3')
      assert.equal(await page.locator('.store-intro h1').count(), 1)
    }
    for (const slug of stores) {
      await page.evaluate(next => {
        history.pushState({}, '', '/perfil/' + next)
        dispatchEvent(new PopStateEvent('popstate'))
      }, slug)
      await page.getByRole('heading', { name: names[slug], exact: true }).waitFor({ timeout: 10000 })
      assert.equal(await page.getByRole('heading', { name: names[slug], exact: true }).count(), 1)
      assert.equal(await page.locator('.social-profile-card').count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).count(), 1)
      for (const other of stores.filter(item => item !== slug)) {
        assert.equal(await page.getByRole('heading', { name: names[other], exact: true }).count(), 0,
          'Perfil anterior ainda visível')
      }
      if (slug === 'loja-a') {
        await page.getByText('Publicações indisponíveis. Você ainda pode acessar a loja.').waitFor()
      }
    }
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const choice = page.getByRole('dialog', { name: /loja ou comprador\?/i })
    await choice.waitFor()
    assert.equal(await choice.locator('.social-account-choice-options > button').count(), 2)
    await choice.locator('.social-account-choice-options > button').first().click()
    await page.waitForURL(/\/comprador\?next=%2Fperfil%2Floja-c/i)
    await page.getByRole('heading', { name: 'Entrar com WhatsApp' }).waitFor()
    assert.deepEqual(failures, [])
    await context.close()
    console.log('SHOPVAX_MULTI_STORE_UX_PASS', browserType.name(), width, height)
  }
} finally {
  await browser.close()
}
