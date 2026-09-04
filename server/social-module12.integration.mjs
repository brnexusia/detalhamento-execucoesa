import fs from 'node:fs'

const feedSource = fs.readFileSync(new URL('../src/SocialFeed.tsx', import.meta.url), 'utf8')
const profileSource = fs.readFileSync(new URL('../src/SocialStoreProfile.tsx', import.meta.url), 'utf8')
const storeSource = fs.readFileSync(new URL('../src/PublicStoreV2.tsx', import.meta.url), 'utf8')
const commerceSource = fs.readFileSync(new URL('./social-commerce-hooks.mjs', import.meta.url), 'utf8')

if (!feedSource.includes('profilePath(post.store.slug, post.product.id)')) throw new Error('Compartilhamento do feed não preserva o produto no perfil social.')
if (!profileSource.includes("new URLSearchParams(window.location.search).get('produto')") || !profileSource.includes('setSelected(items.find')) throw new Error('Perfil social não abre a publicação indicada pelo deep link.')
if (!profileSource.includes('openStore(selected.id)')) throw new Error('Publicação do perfil não consegue seguir para o mesmo produto na loja comercial.')
if (!storeSource.includes("new URLSearchParams(window.location.search).get('produto')") || !storeSource.includes('openPicker(body.product as Product)')) throw new Error('Loja comercial não abre automaticamente o produto indicado.')
if (!commerceSource.includes("app.get('/api/social/stores/:storeSlug/products/:productId'")) throw new Error('Endpoint de detalhe social não foi instalado.')

console.log('social module 12 ok')
