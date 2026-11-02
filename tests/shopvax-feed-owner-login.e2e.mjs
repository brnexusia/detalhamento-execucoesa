import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  let ownerLoggedIn = false
  let meCalls = 0
  await context.route('**/api/auth/me', (route) => {
    meCalls++
    if (!ownerLoggedIn) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Sessão necessária."}' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 'owner-test', name: 'Lojista Teste', email: 'owner@example.test' },
      store: { id: 'loja-teste', slug: 'loja-teste', name: 'Loja Teste' },
    }) })
  })
  await context.route('**/api/admin/bootstrap**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 'owner-test', name: 'Lojista Teste', email: 'owner@example.test' },
      store: { id: 'loja-teste', slug: 'loja-teste', name: 'Loja Teste', plan_tier: 'bronze',
        minimum_order: 400, whatsapp: '5571999999999', eyebrow: 'Atacado',
        tagline: 'Nova coleção', logo_url: '', accent: '#F25C05', is_active: true, onboarding_palette_selected: true },
      sellers: [], products: [], orders: [], stats: { views: 0, carts: 0, orders: 0, value: 0 },
    }) }))
  await context.route('**/api/social/feed**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"posts":[],"page":{"hasMore":false,"nextCursor":null}}' }))

  // Direct paths must always open the same legitimate login form.
  const direct = await context.newPage()
  await direct.goto('http://127.0.0.1:5173/login')
  await direct.getByRole('heading', { name: 'Acesse seu painel.' }).waitFor()
  await direct.goto('http://127.0.0.1:5173/entrar')
  await direct.getByRole('heading', { name: 'Acesse seu painel.' }).waitFor()

  // Anonymous visitor: Feed > Entrar > Loja goes to /entrar with owner dashboard return.
  const guest = await context.newPage()
  await guest.goto('http://127.0.0.1:5173/feed')
  await guest.getByRole('button', { name: 'Entrar' }).click()
  await guest.locator('.social-account-choice-options button').nth(1).click()
  await guest.waitForURL(/\/entrar\?next=%2Fpainel/)
  await guest.getByRole('heading', { name: 'Acesse seu painel.' }).waitFor()

  // User already authenticated via /login should NEVER see a second login prompt on feed.
  ownerLoggedIn = true
  const owner = await context.newPage()
  await owner.goto('http://127.0.0.1:5173/feed')
  await owner.getByRole('button', { name: 'Minha loja' }).waitFor()
  await owner.getByRole('button', { name: 'Minha loja' }).click()
  await owner.waitForURL(/\/painel$/)
  await owner.getByText('Olá, Lojista Teste.').waitFor()

  // Session can become valid after the modal was opened: verify again on click.
  ownerLoggedIn = false
  const delayed = await context.newPage()
  await delayed.goto('http://127.0.0.1:5173/feed')
  await delayed.getByRole('button', { name: 'Entrar' }).waitFor()
  await delayed.getByRole('button', { name: 'Entrar' }).click()
  ownerLoggedIn = true
  await delayed.locator('.social-account-choice-options button').nth(1).click()
  await delayed.waitForURL(/\/painel$/)

  // Logout signal refreshes feed identity without storing any token locally.
  ownerLoggedIn = false
  await owner.goto('http://127.0.0.1:5173/feed')
  await owner.getByRole('button', { name: 'Entrar' }).waitFor()
  assert.ok(meCalls >= 3)
  await context.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_FEED_OWNER_LOGIN_OK')
