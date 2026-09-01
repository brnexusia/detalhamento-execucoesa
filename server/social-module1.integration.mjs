const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

async function request(path) {
  const response = await fetch(`${base}${path}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`)
  return body
}

const health = await request('/api/social/health')
if (health.ok !== true || health.network !== true) throw new Error(`Social network health inválido: ${JSON.stringify(health)}`)
if (!Number.isInteger(health.stores) || !Number.isInteger(health.products)) throw new Error('Contadores sociais inválidos.')

console.log('social module 1 ok')
