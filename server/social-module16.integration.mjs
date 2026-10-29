import fs from 'node:fs/promises'

const files = [
  'src/PublicStoreV2.tsx',
  'src/AdminApp.tsx',
  'src/PlatformAdmin.tsx',
]

for (const file of files) {
  const content = await fs.readFile(file, 'utf8')
  if (content.includes('Atacado Shop')) throw new Error(`${file} ainda expõe Atacado Shop.`)
  if (/\>AS\</.test(content)) throw new Error(`${file} ainda expõe as iniciais AS.`)
}

const store = await fs.readFile('src/PublicStoreV2.tsx', 'utf8')
// O redesign mantém Shopvax como assinatura discreta e promove a marca da loja.
if (!store.includes('<SVBrandSignature />') || !store.includes('store-brand-signature')) throw new Error('Loja pública não exibe assinatura Shopvax.')
if (!store.includes('brand__mark') || !store.includes("(store?.name || 'L').slice(0, 1).toUpperCase()")) throw new Error('Loja pública não usa a identidade própria da loja.')
if (!store.includes('<strong>{store?.name}</strong>')) throw new Error('Nome da loja deixou de ser protagonista no cabeçalho.')

const admin = await fs.readFile('src/AdminApp.tsx', 'utf8')
if (!admin.includes('shopvax-wordmark-light.svg') || !admin.includes('shopvax-symbol-dark.svg')) throw new Error('Painel do lojista não usa a marca vetorizada oficial.')
if (!admin.includes('store-preview-logo') || !admin.includes("(form.name || 'L').trim().slice(0, 1).toUpperCase()") || admin.includes('<span>SV</span>')) throw new Error('Prévia da loja precisa usar sua própria marca ou inicial, nunca SV.')

const platform = await fs.readFile('src/PlatformAdmin.tsx', 'utf8')
if (!platform.includes('shopvax-wordmark-light.svg') || !platform.includes('shopvax-symbol-dark.svg')) throw new Error('Administração não exibe marca oficial Shopvax.')
if (!platform.includes('<div><span><img className="svx-brand-wordmark" src="/brand/shopvax-wordmark.svg"')) throw new Error('Topbar administrativa não exibe o wordmark oficial.')

console.log('social module 16 ok')
