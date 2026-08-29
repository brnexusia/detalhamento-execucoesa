import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Servidor não iniciou a tempo.')
}

async function register() {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Comercial', email: `commercial-${Date.now()}-${Math.random()}@example.test`, password: 'scanner1234', storeName: `Loja Comercial ${Date.now()}`, whatsapp: '5511999999999' }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return { cookie, storeSlug: body.storeSlug }
}

async function admin(path, cookie, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) } })
}

await waitForServer()
const account = await register()

let response = await admin('/api/admin/commercial-config', account.cookie, {
  method: 'PUT',
  body: JSON.stringify({
    paymentMethods: ['pix', 'cartao', 'nao-existe'],
    deliveryMethods: ['retirada', 'combinar', 'teletransporte'],
    note: 'Frete e prazo combinados diretamente com a vendedora.',
  }),
})
assert.equal(response.status, 200)
let config = await response.json()
assert.equal(config.informationalOnly, true)
assert.deepEqual(config.paymentMethods.map((item) => item.key), ['pix', 'cartao'])
assert.deepEqual(config.deliveryMethods.map((item) => item.key), ['retirada', 'combinar'])
assert.equal(config.note, 'Frete e prazo combinados diretamente com a vendedora.')
assert.match(config.disclaimer, /não processa pagamento/i)
assert.match(config.disclaimer, /não calcula ou rastreia frete/i)

response = await admin('/api/admin/commercial-config', account.cookie)
assert.equal(response.status, 200)
config = await response.json()
assert.equal(config.options.payments.pix, 'Pix')
assert.equal(config.options.deliveries.motoboy, 'Motoboy')
assert.equal(config.paymentMethods.some((item) => item.key === 'nao-existe'), false)

response = await fetch(`${base}/api/public/commercial-config/${account.storeSlug}`, {
  headers: { 'User-Agent': 'Mozilla/5.0 CommercialInfoTest' },
})
assert.equal(response.status, 200)
assert.equal(response.headers.get('cache-control'), 'private, no-store')
assert.match(response.headers.get('x-robots-tag') || '', /noindex/)
const publicConfig = await response.json()
assert.equal(publicConfig.informationalOnly, true)
assert.deepEqual(publicConfig.paymentMethods.map((item) => item.label), ['Pix', 'Cartão'])
assert.deepEqual(publicConfig.deliveryMethods.map((item) => item.label), ['Retirada', 'Combinar com a vendedora'])
assert.equal('paymentUrl' in publicConfig, false)
assert.equal('freightQuote' in publicConfig, false)
assert.equal('tracking' in publicConfig, false)
assert.match(publicConfig.disclaimer, /combinados com o atendimento/i)

console.log('[business module 6] informational payment + delivery only: ok')
