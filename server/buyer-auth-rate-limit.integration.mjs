import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const slug = 'rate-limit-front02-' + Date.now()
async function post(action) {
  const response = await fetch(base + '/api/public/store/' + slug + '/customers/' + action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', email: 'test@example.test', password: 'bad-password' }),
  })
  return { status: response.status, body: await response.json() }
}
for (let i = 0; i < 12; i += 1) {
  const result = await post('login')
  assert.equal(result.status, 404, 'Tentativas dentro do limite não podem produzir bloqueio prematuro')
}
let result = await post('login')
assert.equal(result.status, 429, '13ª tentativa de login de comprador deve ser limitada')
assert.match(String(result.body.error), /Muitas tentativas/)
for (let i = 0; i < 6; i += 1) {
  result = await post('register')
  assert.equal(result.status, 404)
}
result = await post('register')
assert.equal(result.status, 429, '7º cadastro de comprador no mesmo IP e loja deve ser limitado')
console.log('SHOPVAX_BUYER_RATE_LIMIT_PASS: 12 logins/6 cadastros por IP e loja')
