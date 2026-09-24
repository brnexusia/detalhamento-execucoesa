import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(process.cwd())
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const srcDir = path.join(root, 'src')
const sourceFiles = fs.readdirSync(srcDir).filter((name) => /\.(?:ts|tsx)$/.test(name))
const source = sourceFiles.map((name) => read(`src/${name}`)).join('\n')

const plans = read('server/system-plans.mjs')
for (const name of ['Bronze', 'Prata', 'Ouro']) assert.match(plans, new RegExp(`name: '${name}'`))
for (const legacy of ['Plano 1', 'Plano 2', 'Plano 3']) assert.doesNotMatch(source, new RegExp(legacy, 'i'))

const auth = read('src/Auth.tsx')
assert.match(auth, /signup-plan-grid/)
assert.match(auth, /const SHOW_SIGNUP_PLANS = false/)
assert.match(auth, /const DEFAULT_SIGNUP_PLAN = 'bronze'/)
assert.match(auth, /api\.register\(\{ \.\.\.form, planCode: form\.planCode \|\| DEFAULT_SIGNUP_PLAN \}\)/)
assert.doesNotMatch(auth, /\/api\/account\/plan/)
assert.doesNotMatch(auth, /fallbackPlans/)

const app = read('server/app.mjs')
assert.match(app, /plan_tier,signup_plan_selected_at/)
assert.match(app, /Selecione Bronze, Prata ou Ouro/)
assert.match(app, /\/api\/admin\/products\/:id\/visibility/)
assert.match(app, /media_asset_variants/)
assert.match(app, /optimizeImageBuffer/)

const nav = read('src/AdminNavigation.tsx')
const order = ['Início', 'Produtos', 'Pedidos', 'Vendedoras', 'Inteligência', 'Minha loja']
let cursor = -1
for (const label of order) {
  const next = nav.indexOf(`label: '${label}'`)
  assert.ok(next > cursor, `Sidebar fora da ordem fixa em: ${label}`)
  cursor = next
}

const route = read('src/AdminRoute.tsx')
assert.doesNotMatch(route, /AdminAdditions/)
assert.doesNotMatch(route, /ProductMediaPanel/)
assert.equal(fs.existsSync(path.join(root, 'src/AdminAdditions.tsx')), false)
assert.equal(fs.existsSync(path.join(root, 'src/ProductMediaPanel.tsx')), false)
assert.equal(fs.existsSync(path.join(root, 'src/PublicStore.tsx')), false)

const admin = read('src/AdminApp.tsx')
assert.match(admin, /updateProductGallery/)
assert.match(admin, /galleryToSave/)
assert.match(admin, /setProductVisibility/)
assert.match(admin, /Esconder/)
assert.match(admin, /stockEnabled/)
assert.match(admin, /optimizedMediaUrl/)
assert.match(admin, /orders-filters/)
assert.match(admin, /pageSize = 18/)
assert.doesNotMatch(admin, /Valor gerado/i)
assert.doesNotMatch(admin, />\s*Fotos dos produtos\s*</)

for (const nativeDialog of [/window\.confirm\s*\(/, /window\.alert\s*\(/, /window\.prompt\s*\(/]) {
  assert.doesNotMatch(source, nativeDialog)
}

for (const awkward of [/item\(ns\)/i, /pedido\(s\)/i, /sessão\(ões\)/i]) {
  assert.doesNotMatch(source, awkward)
}

const frame = read('src/AdminSectionFrame.tsx')
assert.match(frame, /AdminNavigation/)
assert.match(frame, /Shopvax/)
assert.doesNotMatch(frame, /Atacado Shop/)

const home = read('src/Home.tsx')
assert.match(home, /Bronze, Prata ou Ouro/)
assert.match(home, /\/api\/public\/plans/)

const publicStore = read('src/PublicStoreV2.tsx')
for (const label of ['Fechar carrinho', 'Foto anterior', 'Próxima foto', 'Diminuir quantidade', 'Aumentar quantidade']) {
  assert.match(publicStore, new RegExp(label))
}

const socialFeed = read('src/SocialFeed.tsx')
assert.match(socialFeed, /shopvax_social_feed_state_v3/)
assert.match(socialFeed, /productMediaCandidates/)
assert.match(socialFeed, /initialLoadStarted/)
assert.match(socialFeed, /void load\(null\)/)
assert.match(socialFeed, /optimizedMediaUrl/)

const socialNetwork = read('server/social-network-hooks.mjs')
assert.match(socialNetwork, /p\.active=true AND p\.social_published=true/, 'feed social deve excluir produtos escondidos')

const catalogPanel = read('src/BusinessFeaturesPanel.tsx')
assert.match(catalogPanel, /Gerar PDF/)
assert.match(catalogPanel, /downloadCatalogPdf/)

const catalogPdf = read('server/catalog-pdf.mjs')
assert.match(catalogPdf, /gerado via shopvax/)
assert.match(catalogPdf, /fit: \[imageW, imageH\]/)

const mediaOptimizer = read('server/media-optimizer.mjs')
assert.match(mediaOptimizer, /withoutEnlargement: true/)
assert.match(mediaOptimizer, /max: 400/)
assert.match(mediaOptimizer, /max: 900/)
assert.match(mediaOptimizer, /max: 1600/)

const storeCss = read('src/styles.css')
assert.match(storeCss, /object-fit:contain/)
const socialCss = read('src/social-feed.css')
assert.match(socialCss, /object-fit:contain/)

const platform = read('src/PlatformAdmin.tsx')
for (const field of ['photoLimit', 'franchiseeLimit', 'trafficPriority', 'features']) assert.match(platform, new RegExp(field))

console.log('Product polish regression checks passed.')
