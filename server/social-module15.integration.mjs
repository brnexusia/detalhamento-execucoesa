import fs from 'node:fs/promises'

const files = [
  'index.html',
  'src/Home.tsx',
  'src/Auth.tsx',
  'src/App.tsx',
]

for (const file of files) {
  const content = await fs.readFile(file, 'utf8')
  if (/Atacado Shop/.test(content)) throw new Error(`${file} ainda expõe a marca antiga.`)
  if (/\>AS\</.test(content)) throw new Error(`${file} ainda expõe as iniciais antigas.`)
}

const index = await fs.readFile('index.html', 'utf8')
if (!index.includes('<title>Shopvax</title>')) throw new Error('Título público não está como Shopvax.')
if (!index.includes('content="Shopvax — catálogo e feed')) throw new Error('Descrição pública não está como Shopvax.')

const home = await fs.readFile('src/Home.tsx', 'utf8')
if (!home.includes('<span>SV</span> Shopvax')) throw new Error('Landing não está identificada como Shopvax.')

const auth = await fs.readFile('src/Auth.tsx', 'utf8')
if (!auth.includes('<span>SV</span> Shopvax')) throw new Error('Autenticação não está identificada como Shopvax.')

const app = await fs.readFile('src/App.tsx', 'utf8')
if (!app.includes('brand__mark">SV</span>')) throw new Error('Fallback global ainda não usa Shopvax.')

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
if (pkg.name !== 'shopvax') throw new Error('Nome técnico do pacote ainda não é shopvax.')

console.log('social module 15 ok')
