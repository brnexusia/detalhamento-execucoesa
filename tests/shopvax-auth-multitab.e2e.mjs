import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let activeUser = 'A'
  const bootstrap = () => {
    const name = activeUser === 'A' ? 'Laura' : 'Beatriz'
    const store = activeUser === 'A' ? 'empresa-a' : 'empresa-b'
    return {
      user: { id: activeUser, name, email: `${store}@example.test` },
      store: {
        id: store, slug: store, name: store, plan_tier: 'bronze',
        minimum_order: 400, whatsapp: '5511999999999', eyebrow: 'Atacado',
        tagline: 'Coleção', logo_url: '', accent: '#F25C05', is_active: true,
        onboarding_palette_selected: true,
      },
      sellers: [], products: [], orders: [], stats: { views: 0, carts: 0, orders: 0, value: 0 },
    }
  }
  await context.route('**/api/admin/bootstrap', async route => {
    if (!activeUser) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sessão inválida.' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap()) })
  })
  await context.route('**/api/auth/login', async route => {
    activeUser = 'B'
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await context.route('**/api/auth/logout', async route => {
    activeUser = ''
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  const first = await context.newPage()
  await first.goto('http://127.0.0.1:5173/painel')
  await first.getByText('Olá, Laura.').waitFor()
  assert.match(await first.locator('.panel-brand').innerText(), /empresa-a/)
  const second = await context.newPage()
  await second.goto('http://127.0.0.1:5173/entrar')
  await second.locator('input[type=email]').fill('empresa-b@example.test')
  await second.locator('input[type=password]').fill('senha-de-teste-123')
  await second.locator('.auth-form .primary-action').click()
  await second.getByText('Olá, Beatriz.').waitFor()
  await first.getByText('Olá, Beatriz.').waitFor({ timeout: 7000 })
  assert.doesNotMatch(await first.locator('.panel-brand').innerText(), /empresa-a/, 'Empresa antiga não pode permanecer visível')
  assert.match(await first.locator('.panel-brand').innerText(), /empresa-b/)

  await second.getByRole('button', { name: 'Sair' }).click()
  await second.getByRole('heading', { name: 'Acesse seu painel.' }).waitFor()
  await first.getByRole('heading', { name: 'Acesse seu painel.' }).waitFor({ timeout: 7000 })
  assert.equal(await first.locator('.panel-brand').count(), 0, 'Nenhum dado de empresa deve continuar após logout')
  await context.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_AUTH_MULTITAB_OK')
