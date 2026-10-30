import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless:true })
try {
  const context = await browser.newContext({ viewport:{ width:1280,height:850 } })
  let saved = {
    id:'s1', slug:'loja-teste', name:'Loja Teste', eyebrow:'Moda no atacado',
    tagline:'Loja pronta', minimum_order:100, whatsapp:'5511987700123', logo_url:'',
    accent:'#F25C05', seasonal_theme:'padrao', plan_tier:'bronze',
    onboarding_palette_selected:true, is_active:true,
  }
  const updates = []
  await context.route('**/api/admin/bootstrap', async route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({
      user:{ id:'u1',name:'Laura',email:'loja@example.test' },
      store:saved, products:[], sellers:[], orders:[],
      stats:{ views:0,carts:0,orders:0,value:0 },
    }),
  }))
  await context.route('**/api/admin/store', async route => {
    const value = JSON.parse(route.request().postData() || '{}')
    updates.push(value)
    saved = { ...saved, accent:value.accent, seasonal_theme:value.seasonalTheme }
    await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({store:saved}) })
  })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:5173/painel/temas')
  await page.getByRole('heading', { name:'Temas e paletas' }).waitFor()
  await page.getByRole('group', { name:'Temas sazonais' }).getByRole('button', { name:/Black Friday/ }).click()
  assert.equal(updates.length,0,'A prévia não pode alterar a loja')
  await page.getByText('Dica · Black Friday').waitFor()
  await page.getByText('Seleção especial para a temporada.').first().waitFor()
  await page.getByRole('button',{name:/Aplicar à loja/}).click()
  await page.getByText(/Identidade aplicada à loja/).waitFor()
  assert.equal(updates.length,1)
  assert.equal(updates[0].seasonalTheme,'black-friday')
  assert.equal(saved.seasonal_theme,'black-friday')
  const restoreResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/admin/store') && response.request().method() === 'PUT' && response.status() === 200,
  )
  await page.getByRole('button',{name:/Voltar ao tema padrão/}).click()
  await restoreResponse
  await page.getByText(/Identidade aplicada à loja/).waitFor()
  assert.equal(updates.length,2)
  assert.equal(updates[1].seasonalTheme,'padrao')
  assert.equal(updates[1].accent,'#F25C05','Restaurar visual não apaga paleta escolhida')
  await context.close()
} finally { await browser.close() }
console.log('SHOPVAX_THEMES_PANEL_OK')
