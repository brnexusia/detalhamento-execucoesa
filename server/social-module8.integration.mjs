import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function createStore(tier, suffix) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${tier}-${suffix}`, email: `${tier}-${suffix}-${unique}@example.com`, password: 'senha-social-123', storeName: `${tier}-${suffix}-${unique}`, whatsapp: '5511999999999' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${tier}/${suffix}: ${response.status} ${JSON.stringify(body)}`)
  await pool.query('UPDATE stores SET plan_tier=$1 WHERE slug=$2', [tier, body.storeSlug])
  return { ...body, cookie }
}

async function seed(owner, tier, suffix) {
  for (let i = 0; i < 3; i += 1) {
    const response = await fetch(`${base}/api/admin/products`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: `${tier}-${suffix}-${unique}-${i}`, price: 89.9 + i, category: 'Diversidade', mediaUrl: `https://example.invalid/${tier}-${suffix}-${i}.jpg`, mediaType: 'image', active: true }),
    })
    if (!response.ok) throw new Error(`Produto ${tier}/${suffix}/${i}: ${response.status}`)
  }
}

try {
  for (const tier of ['ouro','prata','bronze']) {
    for (const suffix of ['a','b','c']) {
      const owner = await createStore(tier, suffix)
      await seed(owner, tier, suffix)
    }
  }

  const response = await fetch(`${base}/api/social/feed?limit=18`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Feed diversidade: ${response.status} ${JSON.stringify(body)}`)
  if (body.ranking?.diversity !== 'store-round-robin-v1') throw new Error('Estratégia de diversidade não foi declarada.')

  for (const tier of ['ouro','prata','bronze']) {
    const tierPosts = body.posts.filter((post) => post.store.planTier === tier).slice(0, 3)
    if (tierPosts.length < 3) throw new Error(`Amostra insuficiente para ${tier}.`)
    const stores = new Set(tierPosts.map((post) => post.store.id))
    if (stores.size !== 3) throw new Error(`Uma loja monopolizou as primeiras posições do plano ${tier}.`)
  }

  for (let i = 1; i < body.posts.length; i += 1) {
    if (body.posts[i].store.id === body.posts[i - 1].store.id) throw new Error('Feed apresentou a mesma loja em posições consecutivas apesar de haver diversidade disponível.')
  }

  console.log('social module 8 ok')
} finally {
  await pool.end()
}
