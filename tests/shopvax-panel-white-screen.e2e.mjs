import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const origin = process.env.SHOPVAX_TEST_ORIGIN || 'http://127.0.0.1:4173'
const browser = await chromium.launch({headless:true})
try {
  {
    const page = await browser.newPage()
    await page.route('**/api/billing/status', async route => {
      await new Promise(resolve => setTimeout(resolve, 2300))
      await route.fulfill({status:401, contentType:'application/json', body:'{"error":"Sessão necessária."}'})
    })
    await page.goto(origin+'/painel', {waitUntil:'domcontentloaded'})
    await page.getByText('Verificando acesso ao painel…').first().waitFor({state:'visible',timeout:9000})
    const loading = await page.locator('.svx-panel-access-check').count()
    assert(loading>0, 'Should have visible panel access loading state')
    console.log('SHOPVAX_PANEL_LOADING_VISIBLE_OK')
    await page.waitForURL('**/entrar', {timeout:13000})
    console.log('SHOPVAX_PANEL_UNAUTHENTICATED_REDIRECT_OK')
    await page.close()
  }
  {
    const page = await browser.newPage()
    let blocked = 0
    await page.route(/\/assets\/AdminRoute-[^/]+\.js(?:\?.*)?$/, async route => {
      blocked += 1
      await route.abort('failed')
    })
    await page.goto(origin+'/painel', {waitUntil:'domcontentloaded'})
    await page.getByText('Não foi possível abrir esta tela.').waitFor({state:'visible',timeout:15000})
    const btn = page.getByRole('button',{name:'Recarregar página'})
    assert(await btn.isVisible(), 'Manual reload should be available')
    assert(blocked>0, 'Test must actually simulate a failed AdminRoute lazy import')
    console.log('SHOPVAX_LAZY_CHUNK_RECOVERY_OK')
    await page.close()
  }
} finally { await browser.close() }
