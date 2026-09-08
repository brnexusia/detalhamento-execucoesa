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
if (!store.includes('<small>via Shopvax</small>')) throw new Error('Loja pública não exibe Shopvax.')
if (!store.includes('brand__mark">SV</span>')) throw new Error('Loja pública não usa o monograma SV.')

const admin = await fs.readFile('src/AdminApp.tsx', 'utf8')
if (!admin.includes('<strong>Shopvax</strong>')) throw new Error('Painel do lojista não exibe Shopvax.')
if (!admin.includes('store-preview-logo">{form.logoUrl ? <img src={form.logoUrl} alt="" /> : <span>SV</span>}')) throw new Error('Prévia da loja ainda não usa SV.')

const platform = await fs.readFile('src/PlatformAdmin.tsx', 'utf8')
if (!platform.includes('<div><strong>Shopvax</strong><small>Administração</small></div>')) throw new Error('Administração da plataforma não exibe Shopvax.')
if (!platform.includes('<div><span>Shopvax</span><strong>')) throw new Error('Topbar administrativa não exibe Shopvax.')

console.log('social module 16 ok')
