import fs from 'node:fs'

const feedSource = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const profileSource = fs.readFileSync(new URL('../src/SocialStoreProfile.tsx', import.meta.url), 'utf8')
const commerceSource = fs.readFileSync(new URL('./social-commerce-hooks.mjs', import.meta.url), 'utf8')

if (!feedSource.includes('/seller-route') || !feedSource.includes('openCommercialStore')) throw new Error('Carrinho do feed não preserva a rota comercial por vendedora.')
if (!profileSource.includes('/seller-route') || !profileSource.includes('commercialStorePath')) throw new Error('Botão Loja do perfil não preserva a rota comercial por vendedora.')
if (!commerceSource.includes("app.get('/api/social/stores/:storeSlug/seller-route'")) throw new Error('Endpoint de afinidade comercial não está instalado.')

console.log('social module 13 ok')
