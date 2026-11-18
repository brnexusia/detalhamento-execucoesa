import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/ShopvaxLandingPage.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../src/HomeRoute.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('a rota para-lojas usa a landing page nova', () => {
  assert.match(app, /pathname === '\/para-lojas'/)
  assert.match(route, /ShopvaxLandingPage/)
  assert.match(source, /data-shopvax-landing/)
})
test('a landing page mantém rotas reais sem redirecionar para ela mesma', () => {
  assert.match(source, /signup: "\/criar-conta"/)
  assert.match(source, /partner: "\/parceiros"/)
  assert.match(source, /api\/public\/plans/)
  assert.doesNotMatch(source, /shopvax\.com\.br\/para-lojas/)
})
test('as folhas de estilo ficam isoladas e os recursos de venda existem', () => {
  assert.match(source, /attachShadow/)
  assert.match(source, /createPortal/)
  assert.match(source, /function Faq/)
  assert.match(source, /function Plans/)
  assert.match(source, /function Partners/)
  assert.match(source, /function Hero/)
})
