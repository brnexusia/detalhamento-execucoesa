import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function register(label) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Scanner ${label}`,
      email: `scanner-${label}-${Date.now()}@example.test`,
      password: 'scanner1234',
      storeName: `Loja Scanner ${label}`,
      whatsapp: '5511999999999',
    }),
  })
  assert.equal(response.status, 201, `cadastro ${label} deve funcionar`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, `cadastro ${label} deve retornar sessão`)
  return cookie
}

async function api(path, cookie, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(options.headers || {}),
    },
  })
}

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const health = await fetch(`${base}/health`).then((response) => response.json())
    if (health.database) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (attempt === 39) throw new Error('servidor/banco não ficaram prontos')
}

const cookieA = await register('a')
let response = await api('/api/admin/imports', cookieA, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://Example.com/catalogo?utm_source=teste#produto' }),
})
assert.equal(response.status, 201, 'primeiro job deve ser criado')
let payload = await response.json()
assert.equal(payload.duplicated, false)
assert.equal(payload.job.status, 'queued')
assert.equal(payload.job.progress, 0)
assert.equal(payload.job.source_url, 'https://example.com/catalogo')
const jobId = payload.job.id

response = await api('/api/admin/imports', cookieA, {
  method: 'POST',
  body: JSON.stringify({ url: 'example.com/catalogo' }),
})
assert.equal(response.status, 200, 'mesma URL ativa deve reutilizar job')
payload = await response.json()
assert.equal(payload.duplicated, true)
assert.equal(payload.job.id, jobId)

response = await api('/api/admin/imports', cookieA, {
  method: 'POST',
  body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
})
assert.equal(response.status, 400, 'URL privada deve ser bloqueada')

response = await api('/api/admin/imports', cookieA)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.jobs.length, 1, 'loja A deve enxergar apenas o próprio job')
assert.equal(payload.jobs[0].id, jobId)

const cookieB = await register('b')
response = await api('/api/admin/imports', cookieB)
assert.equal(response.status, 200)
payload = await response.json()
assert.equal(payload.jobs.length, 0, 'loja B não pode enxergar jobs da loja A')

response = await fetch(`${base}/api/admin/imports`)
assert.equal(response.status, 401, 'rota deve exigir sessão')

console.log('[scanner module 1] API integration: ok')
