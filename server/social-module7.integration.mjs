import pg from 'pg'

const { Pool } = pg
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`

async function store(tier) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: tier, email: `${tier}-${unique}@example.com`, password: 'senha-social-123', storeName: `${tier} ${unique}`, whatsapp: '5511999999999' }),
  })
  const body = await response.json().catch(() => ({}))
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (!response.ok || !cookie) throw new Error(`Cadastro ${tier}: ${response.status} ${JSON.stringify(body)}`)
  await pool.query('UPDATE stores SET plan_tier=$1 WHERE slug=$2', [tier, body.storeSlug])
  return { ...body, cookie }
}

async function products(owner, tier, amount) {
  for (let i = 0; i < amount; i += 1) {
    const response = await fetch(`${base}/api/admin/products`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: `${tier} ${unique} ${i}`, price: 49.9 + i, category: 'Ranking', mediaUrl: `https://example.invalid/${tier}-${i}.jpg`, mediaType: 'image', active: true }),
    })
    if (!response.ok) throw new Error(`Produto ${tier}/${i}: ${response.status}`)
  }
}

try {
  const ouro = await store('ouro')
  const prata = await store('prata')
  const bronze = await store('bronze')
  await products(ouro, 'ouro', 5)
  await products(prata, 'prata', 4)
  await products(bronze, 'bronze', 3)

  const firstResponse = await fetch(`${base}/api/social/feed?limit=6`)
  const first = await firstResponse.json().catch(() => ({}))
  if (!firstResponse.ok) throw new Error(`Feed ranking: ${firstResponse.status} ${JSON.stringify(first)}`)
  const tiers = first.posts?.map((post) => post.store.planTier) || []
  const expected = ['ouro','prata','ouro','bronze','ouro','prata']
  if (tiers.length !== expected.length || tiers.some((tier, index) => tier !== expected[index])) {
    throw new Error(`Prioridade por plano inválida: ${JSON.stringify(tiers)}`)
  }
  if (first.ranking?.weights?.ouro !== 3 || first.ranking?.weights?.prata !== 2 || first.ranking?.weights?.bronze !== 1) throw new Error('Pesos do ranking não foram declarados corretamente.')
  if (!first.page?.nextCursor) throw new Error('Feed ponderado não retornou cursor para continuidade.')

  const secondResponse = await fetch(`${base}/api/social/feed?limit=6&cursor=${encodeURIComponent(first.page.nextCursor)}`)
  const second = await secondResponse.json().catch(() => ({}))
  if (!secondResponse.ok) throw new Error(`Segunda página ranking: ${secondResponse.status} ${JSON.stringify(second)}`)
  const ids = new Set(first.posts.map((post) => post.id))
  if (second.posts.some((post) => ids.has(post.id))) throw new Error('Paginação ponderada repetiu publicação entre páginas.')

  console.log('social module 7 ok')
} finally {
  await pool.end()
}
