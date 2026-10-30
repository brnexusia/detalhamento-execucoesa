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
