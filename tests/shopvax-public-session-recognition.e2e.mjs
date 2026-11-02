import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  let buyerLoggedIn = true
  const buyer = { id: 'buyer-test', phone: '5571999999999', name: 'Comprador Teste', email: 'buyer@example.test', profileCompleted: true }

  await context.route('**/api/auth/me', (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"Sessão necessária."}',
  }))
  await context.route('**/api/public/buyer-auth/me', (route) => route.fulfill({
    status: buyerLoggedIn ? 200 : 401, contentType: 'application/json',
    body: buyerLoggedIn ? JSON.stringify({ buyer }) : '{"error":"Entre com seu WhatsApp."}',
  }))
  await context.route('**/api/public/customers/logout', (route) => {
    buyerLoggedIn = false
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await context.route('**/api/social/feed**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"posts":[],"page":{"hasMore":false,"nextCursor":null}}',
  }))
  await context.route('**/api/social/stores/loja-teste', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      store: { id: 'store-test', slug: 'loja-teste', name: 'Loja Teste', tagline: 'Moda', eyebrow: 'Atacado', logoUrl: '', accent: '#F25C05', planTier: 'bronze', productCount: 0 },
      stats: { followers: 0, views: 0, following: false },
    }),
  }))
  await context.route('**/api/social/stores/loja-teste/publications', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"publications":[]}',
  }))

  const page = await context.newPage()
  await page.goto('http://127.0.0.1:5173/feed')
  await page.getByRole('button', { name: 'Minha conta' }).waitFor()

  // Feed e perfil social precisam reconhecer a mesma sessão global de comprador.
  await page.goto('http://127.0.0.1:5173/perfil/loja-teste')
  await page.getByRole('button', { name: 'Minha conta' }).waitFor()
  await page.getByRole('button', { name: 'Minha conta' }).click()
  await page.waitForURL(/\/comprador$/)
  await page.getByRole('heading', { name: 'Comprador Teste' }).waitFor()

  // Logout revoga a identidade global; todas as superfícies voltam a mostrar Entrar.
  await page.getByRole('button', { name: 'Sair' }).click()
  await page.goto('http://127.0.0.1:5173/feed')
  await page.getByRole('button', { name: 'Entrar' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Minha conta' }).count(), 0)
  await context.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_PUBLIC_SESSION_RECOGNITION_OK')
