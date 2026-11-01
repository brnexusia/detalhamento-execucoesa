import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')

test('texto de comparação com todos os planos, não apenas dois', () => {
  const plans = read('src/ShopvaxPlans.tsx')
  assert.match(plans, /Ficou em dúvida entre os planos\?/)
  assert.doesNotMatch(plans, /Ficou em dúvida entre dois planos\?/)
})

test('cursor de mão nos controles e imagens da marca não arrastáveis', () => {
  const css = read('src/shopvax-accessibility-polish.css')
  const main = read('src/main.tsx')
  assert.match(css, /button:not\(:disabled\)/)
  assert.match(css, /cursor:\s*pointer/)
  assert.match(css, /-webkit-user-drag:\s*none/)
  assert.match(main, /import '\.\/shopvax-accessibility-polish\.css'/)
  assert.match(main, /event\.preventDefault\(\)/)
  assert.match(main, /HTMLImageElement/)
})

test('fontes miúdas da landing e painel receberam melhoria sem trocar a grade', () => {
  const css = read('src/shopvax-accessibility-polish.css')
  for (const selector of ['.home-trustline', '.home-pricing__note', '.svx-plans__intro', '.svx-dashboard__welcome', '.svx-dashboard__bottom']) {
    assert(css.includes(selector), `Falta ajuste de texto em ${selector}`)
  }
  assert.doesNotMatch(css, /grid-template-columns/, 'Escala de fonte não deve alterar layout ou grade')
})

test('feed social coloca perfil circular acima das interações e amplia visualização', () => {
  const feed = read('src/SocialFeed.tsx')
  const css = read('src/shopvax-social-feed-layout.css')
  const asideIndex = feed.indexOf('<aside className="social-feed-actions"')
  assert(asideIndex > 0, 'Barra de interações ausente')
  const actions = feed.slice(asideIndex)
  assert.match(actions, /className="social-feed-store"/)
  assert(actions.indexOf('className="social-feed-store"') < actions.indexOf('onClick={like}'), 'Perfil deve vir acima da curtida')
  assert.match(feed, /className="social-feed-store-name"/)
  assert.match(css, /\.social-feed-actions \.social-feed-store\s*\{[\s\S]*?border-radius:50%/)
  assert.match(css, /width:min\(calc\(65dvh \+ 86px\)/)
  assert(css.lastIndexOf('width:calc(100% - 86px)') > css.indexOf('width:59%'), 'Mídia desktop não foi ampliada')
})

test('login e criar conta usam copy, exemplos e logo oficial do Shopvax', () => {
  const auth = read('src/Auth.tsx')
  const css = read('src/shopvax-auth-official.css')
  assert.match(auth, /Shopvax · o melhor jeito para vender/)
  assert.doesNotMatch(auth, /o jeito do atacado vender|placeholder="Felipe"|placeholder="Suprema Line"/i)
  assert.match(auth, /placeholder="Loja"/)
  assert.match(auth, /placeholder="Ex\.: Atacado Aurora"/)
  assert.match(auth, /className="auth-register-brand"/)
  assert.match(auth, /src="\/brand\/shopvax-wordmark\.svg"/)
  assert.match(css, /\.auth-shell--register \.auth-register-brand/)
})
