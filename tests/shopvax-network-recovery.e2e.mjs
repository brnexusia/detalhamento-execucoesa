import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const makeProduct = (id, name) => ({
  id, sku: id, name, description: name, price: 59.9, category: 'Roupas',
  mediaUrl: '', mediaType: 'image', images: [], variations: [], stockQuantity: 100,
})
const base = {
  store: { slug: 'loja-teste', name: 'Loja Teste', minimumOrder: 100, whatsapp: '5571999999999', accent: '#F25C05' },
  seller: { slug: 'ana', name: 'Ana', phone: '5571999999999' },
  categories: ['Roupas'],
  page: { hasMore: false, nextCursor: null, limit: 24 },
}
const payload = (name) => ({ ...base, products: [makeProduct(name, name)] })

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  let unavailable = true
  const initialRoute = async (route) => route.fulfill(unavailable
    ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporariamente indisponível' }) }
    : { status: 200, contentType: 'application/json', body: JSON.stringify(payload('Coleção Inicial')) })
  await page.route('**/api/public/store/loja-teste**', initialRoute)
  await page.goto('http://127.0.0.1:5173/loja-teste')
  await page.getByRole('alert').getByText(/Não foi possível abrir a loja/).waitFor()
  assert.equal(await page.getByText('Abrindo a loja…').count(), 0, 'Não pode manter spinner infinito após 503')
  unavailable = false
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await page.locator('.product-card').first().waitFor()
  assert.match(await page.locator('.product-card').first().innerText(), /Coleção Inicial/)

  await page.unroute('**/api/public/store/loja-teste**', initialRoute)
  let beganOld = false
  await page.route('**/api/public/store/loja-teste**', async (route) => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') || ''
    if (q === 'blusa') { beganOld = true; await new Promise((resolve) => setTimeout(resolve, 1000)) }
    if (q === 'saia') await new Promise((resolve) => setTimeout(resolve, 35))
    const name = q === 'saia' ? 'Saia Atual' : q === 'blusa' ? 'Blusa Antiga' : 'Coleção Inicial'
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(name)) }) }
    catch { /* Requisição abortada pela busca mais recente: comportamento esperado */ }
  })
  await page.locator('.search-box input').fill('blusa')
  await page.waitForTimeout(430)
  assert(beganOld, 'A busca antiga deve ter começado antes da troca do filtro')
  await page.locator('.search-box input').fill('saia')
  await page.getByText('Saia Atual', { exact: true }).first().waitFor()
  await page.waitForTimeout(1100)
  assert.equal(await page.getByText('Blusa Antiga', { exact: true }).count(), 0, 'Resultado obsoleto não pode substituir pesquisa nova')
  assert.match(await page.locator('.product-grid').innerText(), /Saia Atual/)
  await page.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_NETWORK_RECOVERY_OK')
