const base = process.env.BASE_URL || 'http://127.0.0.1:3000'

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
const response = await fetch(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Loja Social Teste',
    email: `social-${unique}@example.com`,
    password: 'senha-social-123',
    storeName: `Loja Social ${unique}`,
    whatsapp: '5511999999999',
  }),
})
const registration = await response.json().catch(() => ({}))
if (!response.ok || !registration.storeSlug) throw new Error(`Falha ao criar loja social: ${response.status} ${JSON.stringify(registration)}`)

const profileResponse = await fetch(`${base}/api/social/stores/${registration.storeSlug}`)
const profile = await profileResponse.json().catch(() => ({}))
if (!profileResponse.ok) throw new Error(`Perfil social não abriu: ${profileResponse.status} ${JSON.stringify(profile)}`)
if (profile.store?.slug !== registration.storeSlug) throw new Error('Perfil retornou loja incorreta.')
if (profile.store?.planTier !== 'bronze') throw new Error('Nova loja deveria iniciar no plano social bronze.')
if (profile.store?.productCount !== 0) throw new Error('Nova loja deveria iniciar sem produtos.')
if (profile.stats?.followers !== 0 || profile.stats?.views !== 0) throw new Error('Métricas sociais iniciais inválidas.')

console.log('social module 2 ok')
