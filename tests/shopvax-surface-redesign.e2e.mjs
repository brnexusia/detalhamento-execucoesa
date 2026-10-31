import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

/* Regressão visual das superfícies que estavam com CSS legado.
   Testa CSS efetivamente renderizado em DOM real, não só se o arquivo existe.
   Respeita marca/acento da loja e não apresenta preços inventados. */
const legacy = ['src/social-feed.css','src/social-profile.css'].map(path=>readFileSync(path,'utf8'))
for (const sheet of legacy) assert.doesNotMatch(sheet, /#(?:c8ff38|d9ff69|ff4567)/i,'O verde neon/rosa legado não pode voltar')
for (const path of ['src/styles.css','src/saas.css','src/platform-admin.css','src/ux-polish.css','src/customer-account.css']) {
  assert.doesNotMatch(readFileSync(path,'utf8'),/#(?:c94c2d|171714)|Libre Caslon Display|DM Sans/i,'Fonte ou cor do tema antigo: '+path)
}
for (const path of ['src/shopvax-auth-official.css','src/shopvax-social-official.css','src/shopvax-cross-surface.css']) {
  const css=readFileSync(path,'utf8')
  assert.match(css,/Archivo Narrow/,'Tipografia do sistema ausente: '+path)
}
assert.doesNotMatch(readFileSync('src/ShopvaxFirstRun.tsx','utf8'),/R\$ 284,50|PASSO 1 DE 2/)

const browser=await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign',{recursive:true})
const profile={
 store:{id:'s1',slug:'look-premium',name:'Look Premium',tagline:'Moda para o seu atacado',eyebrow:'Moda feminina',
   logoUrl:'',accent:'#E9B21C',planTier:'prata',productCount:1},
 stats:{followers:21,views:56,following:false}
}
const publication={id:'p1',sku:'REF-10',name:'Vestido Aurora',description:'Modelo de demonstração',price:49.9,category:'Vestidos',mediaUrl:'',mediaType:'image',variations:[],publishedAt:new Date().toISOString()}
const post={id:'post-01',product:publication,store:{...profile.store,planTier:'prata'},interactions:{views:56,likes:2,shares:1,followers:21,liked:false,following:false}}
const bootstrap={
 user:{id:'u1',email:'look@shopvax.test',name:'Lojista Teste'},
 store:{id:'s1',slug:'look-premium',name:'Look Premium',eyebrow:'Moda feminina',tagline:'Atacado',minimum_order:0,whatsapp:'5571999999999',logo_url:'',accent:'#F25C05',is_active:true,plan_tier:'bronze',onboarding_palette_selected:false},
 products:[],sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0}
}
try {
 for (const [width,height] of [[390,844],[1440,900]]) {
  const context=await browser.newContext({viewport:{width,height}})
  const page=await context.newPage()
  await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false,clientId:null})}))
  await page.goto('http://127.0.0.1:5173/entrar')
  await page.locator('.auth-form__head h2').waitFor()
  let design=await page.evaluate(()=>{
   const poster=getComputedStyle(document.querySelector('.auth-poster'))
   const title=getComputedStyle(document.querySelector('.auth-form__head h2'))
   const button=getComputedStyle(document.querySelector('.auth-form > .primary-action'))
   return {poster:poster.backgroundColor,title:title.fontFamily,cta:button.backgroundColor,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}
  })
  assert.equal(design.poster,'rgb(22, 21, 20)')
  assert.match(design.title,/Archivo Narrow/)
  assert.equal(design.cta,'rgb(242, 92, 5)')
  assert(design.scrollWidth<=design.width+2,'Login com rolagem horizontal: '+JSON.stringify(design))
  assert.match(await page.locator('.auth-poster__ribbon').innerText(),/CATÁLOGO/)
  await page.screenshot({path:'artifacts/shopvax-redesign/login-'+width+'.png',fullPage:true})
  await page.getByRole('button',{name:'Criar conta',exact:true}).last().click()
  await page.waitForURL('**/criar-conta')
  await page.getByRole('heading',{name:/Comece com a sua loja/i}).waitFor()
  assert.equal(await page.locator('.auth-form input[autocomplete="name"]').count(),1)
  await page.screenshot({path:'artifacts/shopvax-redesign/cadastro-'+width+'.png',fullPage:true})

  await page.route('**/api/social/feed?**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({posts:[post],page:{hasMore:false,nextCursor:null}})}))
  await page.goto('http://127.0.0.1:5173/feed')
  await page.locator('.social-feed-card').waitFor()
  design=await page.evaluate(()=>{
   const add=getComputedStyle(document.querySelector('.social-feed-add'))
   const title=getComputedStyle(document.querySelector('.social-feed-copy h2'))
   const media=getComputedStyle(document.querySelector('.social-feed-media'))
   return {cta:add.backgroundColor,title:title.fontFamily,media:media.backgroundColor,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}
  })
  assert.equal(design.cta,'rgb(233, 178, 28)','CTA deve usar paleta da própria loja')
  assert.match(design.title,/Archivo Narrow/)
  assert(design.scrollWidth<=design.width+2,'Feed com rolagem horizontal: '+JSON.stringify(design))
  await page.screenshot({path:'artifacts/shopvax-redesign/feed-social-'+width+'.png'})
  await page.getByRole('button',{name:/Montar pedido/i}).click()
  await page.getByRole('button',{name:/Abrir carrinho da Look Premium/}).click()
  await page.locator('.feed-cart-sheet').waitFor()
  assert.match(await page.locator('.feed-cart-sheet').innerText(),/Vestido Aurora/)
  await page.screenshot({path:'artifacts/shopvax-redesign/talao-social-'+width+'.png'})

  await page.route('**/api/social/stores/look-premium/publications',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({publications:[publication]})}))
  await page.route('**/api/social/stores/look-premium',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(profile)}))
  await page.goto('http://127.0.0.1:5173/perfil/look-premium')
  await page.getByRole('heading',{name:'Look Premium'}).waitFor()
  design=await page.evaluate(()=>{
   const profile=getComputedStyle(document.querySelector('.social-profile-page'))
   const store=getComputedStyle(document.querySelector('.social-profile-actions .is-store'))
   const title=getComputedStyle(document.querySelector('.social-profile-identity h1'))
   return {bg:profile.backgroundColor,cta:store.backgroundColor,title:title.fontFamily,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}
  })
  assert.equal(design.bg,'rgb(243, 240, 232)')
  assert.equal(design.cta,'rgb(233, 178, 28)')
  assert.match(design.title,/Archivo Narrow/)
  assert(design.scrollWidth<=design.width+2,'Perfil com rolagem horizontal: '+JSON.stringify(design))
  await page.screenshot({path:'artifacts/shopvax-redesign/perfil-'+width+'.png',fullPage:true})
  await page.locator('.social-profile-grid > button').first().click()
  await page.locator('.social-profile-viewer').waitFor()
  await page.getByRole('button',{name:/Abrir na loja/i}).waitFor()

  await page.route('**/api/admin/bootstrap',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(bootstrap)}))
  await page.goto('http://127.0.0.1:5173/painel')
  await page.getByRole('heading',{name:/Qual a cor da sua loja/i}).waitFor()
  assert.equal(await page.locator('.svx-onboarding__choices > button').count(),3)
  assert.doesNotMatch(await page.locator('.svx-onboarding').innerText(),/R\$ 284,50|PASSO 1 DE 2/)
  await page.screenshot({path:'artifacts/shopvax-redesign/onboarding-'+width+'.png',fullPage:true})

  assert.match(await page.locator('.svx-onboarding__intro').innerText(),/Temas e paletas/)
  await page.locator('.svx-onboarding__footer').getByRole('button',{name:'Temas e paletas'}).click()
  await page.waitForURL('**/painel/temas')
  await page.getByRole('heading',{name:'Temas e paletas'}).waitFor()

  console.log('SURFACE_REDESIGN_PASS',width,height)
  await context.close()
 }
} finally { await browser.close() }
console.log('SHOPVAX_SURFACES_OK')
