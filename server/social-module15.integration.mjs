import fs from 'node:fs/promises'

const files = [
  'index.html',
  'src/Home.tsx',
  'src/Auth.tsx',
  'src/App.tsx',
  'README.md',
  'MIGRATION_NOTE.md',
]

for (const file of files) {
  const content = await fs.readFile(file, 'utf8')
  if (/Atacado Shop/.test(content)) throw new Error(`${file} ainda expõe a marca antiga.`)
  if (/\>AS\</.test(content)) throw new Error(`${file} ainda expõe as iniciais antigas.`)
}

const index = await fs.readFile('index.html', 'utf8')
if (!index.includes('<title>Shopvax</title>')) throw new Error('Título público não está como Shopvax.')
if (!index.includes('content="Shopvax — catálogo e feed')) throw new Error('Descrição pública não está como Shopvax.')
if (!/href="\/favicon\.svg(?:\?[^"]*)?"/.test(index)) throw new Error('Favicon do Shopvax não foi conectado ao HTML.')
const favicon = await fs.readFile('public/favicon.svg', 'utf8')
if (!favicon.includes('<svg') || !favicon.includes('#161514') || !favicon.includes('#F25C05')) throw new Error('Favicon Shopvax inválido.')

const home = await fs.readFile('src/Home.tsx', 'utf8')
if (!home.includes('/brand/shopvax-wordmark.svg') || !home.includes('/brand/shopvax-symbol.svg')) throw new Error('Landing não usa a marca vetorizada oficial Shopvax.')

const auth = await fs.readFile('src/Auth.tsx', 'utf8')
if (!auth.includes('/brand/shopvax-wordmark-light.svg') || !auth.includes('/brand/shopvax-symbol-dark.svg')) throw new Error('Autenticação não usa o logotipo oficial no tema escuro.')

const app = await fs.readFile('src/App.tsx', 'utf8')
const loading = await fs.readFile('src/ShopvaxLoading.tsx', 'utf8')
const motion = await fs.readFile('src/ShopvaxBrandMotion.tsx', 'utf8')
const officialSymbol = await fs.readFile('public/brand/shopvax-symbol.svg', 'utf8')
if (!app.includes('<ShopvaxLoading label="Abrindo Shopvax…" />') || !loading.includes('<ShopvaxBrandMotion'))
  throw new Error('Fallback global não utiliza o carregamento vetorial da marca Shopvax.')
const officialPaths = [...officialSymbol.matchAll(/d="([^"]+)"/g)].map(match => match[1])
if (officialPaths.length !== 2 || officialPaths.some(path => !motion.includes('d="' + path + '"')))
  throw new Error('Motion de carregamento precisa reutilizar os dois paths vetoriais oficiais V/A.')

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
if (pkg.name !== 'shopvax') throw new Error('Nome técnico do pacote ainda não é shopvax.')

console.log('social module 15 ok')
