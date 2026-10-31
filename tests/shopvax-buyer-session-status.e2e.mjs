import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 860 } })
  let activeUser = ''
  let offline = false
  const orders = [
    { id: 'o1', code: 'AS-001', total: 500, status: 'whatsapp', created_at: '2026-10-31T13:00:00Z', seller_name: 'Carla', items: [{ name: 'Peça', quantity: 1 }] },
    { id: 'o2', code: 'AS-002', total: 250, status: 'confirmado', created_at: '2026-10-31T13:01:00Z', seller_name: 'Carla', items: [{ name: 'Peça', quantity: 1 }] },
    { id: 'o3', code: 'AS-003', total: 125, status: 'cancelled', created_at: '2026-10-31T13:02:00Z', seller_name: 'Carla', items: [{ name: 'Peça', quantity: 1 }] },
  ]
  await context.route('**/api/public/store/loja-a/phase2-config', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ store: { slug: 'loja-a', name: 'Loja A' }, customerLoginEnabled: true }),
  }))
  await context.route('**/api/public/store/loja-a/customers/me', route => {
    if (offline) return route.abort('internetdisconnected')
    if (!activeUser) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Entre para acessar sua conta."}' })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        store: { slug: 'loja-a', name: 'Loja A' },
        customer: { id: activeUser, name: activeUser === '1' ? 'Comprador Um' : 'Comprador Dois', email: 'teste@example.test', phone: '' },
        orders: activeUser === '1' ? [] : orders,
        semantics: 'Abertura do WhatsApp não comprova mensagem enviada ou venda.',
      }),
    })
  })
  await context.route('**/api/public/store/loja-a/customers/login', route => {
    activeUser = route.request().postDataJSON().email.startsWith('um') ? '1' : '2'
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await context.route('**/api/public/customers/logout', route => {
    activeUser = ''
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  const one = await context.newPage()
  const two = await context.newPage()
  await one.goto('http://127.0.0.1:5173/cliente/loja-a')
  await two.goto('http://127.0.0.1:5173/cliente/loja-a')
  await one.getByRole('heading', { name: 'Acesse seus pedidos' }).waitFor()
  await two.getByRole('heading', { name: 'Acesse seus pedidos' }).waitFor()

  await one.getByLabel('E-mail').fill('um@example.test')
  await one.getByLabel('Senha').fill('senha1234')
  await one.getByRole('button', { name: 'Entrar na conta' }).click()
  await one.getByRole('heading', { name: 'Comprador Um' }).waitFor()
  await two.getByRole('heading', { name: 'Comprador Um' }).waitFor({ timeout: 7000 })

  await two.getByRole('button', { name: 'Sair' }).click()
  await two.getByRole('heading', { name: 'Acesse seus pedidos' }).waitFor()
  await one.getByRole('heading', { name: 'Acesse seus pedidos' }).waitFor({ timeout: 7000 })
  assert.equal(await one.getByRole('heading', { name: 'Comprador Um' }).count(), 0)

  await two.getByLabel('E-mail').fill('dois@example.test')
  await two.getByLabel('Senha').fill('senha1234')
  await two.getByRole('button', { name: 'Entrar na conta' }).click()
  await one.getByRole('heading', { name: 'Comprador Dois' }).waitFor({ timeout: 7000 })
  await one.getByText('Pedido preparado').waitFor()
  await one.getByText('Confirmado pela loja').waitFor()
  await one.getByText('Cancelado', { exact: true }).waitFor()
  await one.getByText('Abrir o WhatsApp não confirma que a mensagem foi enviada.').waitFor()
  await one.getByText('Confirmação manual da loja; não significa pagamento recebido.').waitFor()
  assert.equal(await one.getByText('Enviado ao WhatsApp').count(), 0)

  offline = true
  await two.bringToFront()
  await one.bringToFront()
  await one.getByRole('heading', { name: 'Acesse seus pedidos' }).waitFor({ timeout: 7000 })
  await one.getByText(/Failed to fetch|Não foi possível|fetch failed/i).waitFor()
  offline = false
  await two.bringToFront()
  await one.bringToFront()
  await one.getByRole('heading', { name: 'Comprador Dois' }).waitFor({ timeout: 7000 })

  await context.close()
  console.log('SHOPVAX_BUYER_SESSION_STATUS_PASS: two tabs, two users, errors and truthful order states')
} finally {
  await browser.close()
}
