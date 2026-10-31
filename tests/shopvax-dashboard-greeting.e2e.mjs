import assert from 'node:assert/strict'
import { chromium } from 'playwright'

/* B05: a saudação do painel corresponde ao relógio do navegador do lojista.
   O fuso da loja não é cadastrado na API; não o inventamos. */
const browser = await chromium.launch({headless:true})
const bootstrap = {
  user:{id:'u1',email:'laura@example.test',name:'Laura Silva'},
  store:{id:'s1',slug:'loja-teste',name:'Loja Teste',eyebrow:'Moda no atacado',tagline:'',
    minimum_order:0,whatsapp:'5511999999999',logo_url:'',accent:'#F25C05',
    is_active:true,plan_tier:'bronze',onboarding_palette_selected:true},
  products:[],sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0}
}
try {
  for (const [clock,expected] of [
    ['2026-10-31T09:00:00-03:00','Bom dia, Laura.'],
    ['2026-10-31T15:00:00-03:00','Boa tarde, Laura.'],
    ['2026-10-31T21:00:00-03:00','Boa noite, Laura.'],
  ]) {
    const context = await browser.newContext({timezoneId:'America/Bahia',viewport:{width:390,height:844}})
    await context.route('**/api/admin/bootstrap',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(bootstrap)
    }))
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(clock))
    await page.goto('http://127.0.0.1:5173/painel')
    const title = page.locator('.svx-dashboard__welcome h1')
    await title.waitFor()
    assert.equal((await title.textContent())?.trim(),expected) // CSS mantém maiúsculas visuais da prancha oficial
    assert.match(await page.locator('.svx-dashboard__welcome').innerText(),/Loja Teste/)
    await context.close()
  }
} finally {
  await browser.close()
}
console.log('SHOPVAX_DASHBOARD_GREETING_OK')
