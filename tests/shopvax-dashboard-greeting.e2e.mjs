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
    await context.route('**/api/admin/bootstrap*',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(bootstrap)
    }))
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(clock))
    await page.goto('http://127.0.0.1:5173/painel')
    const title = page.locator('.svx-dashboard__welcome h1')
    await title.waitFor()
    assert.equal((await title.textContent())?.trim(),expected) // CSS mantém maiúsculas visuais da prancha oficial
    assert.match(await page.locator('.svx-dashboard__welcome').innerText(),/Loja Teste/)
    assert.equal(await page.getByText('Saudação no horário deste dispositivo').count(),0)
    assert.equal(await page.getByRole('heading',{name:'Loja pronta'}).count(),0,
      'Não duplicar o onboarding com um segundo cartão Loja pronta')
    assert.equal(await page.getByRole('heading',{name:'Prepare sua loja'}).count(),1,
      'Conservar apenas o guia detalhado Primeiros passos')
    const panelStyle=await page.evaluate(()=>{
      const mark=document.querySelector('.panel-brand .svx-panel-mark')
      const store=document.querySelector('.panel-brand > div > small')
      const wordmark=document.querySelector('.panel-brand .svx-brand-wordmark')
      const open=document.querySelector('.panel-topbar .panel-store-link')
      return {border:getComputedStyle(mark).borderTopWidth,bg:getComputedStyle(mark).backgroundColor,
        endOffset:Math.abs(store.getBoundingClientRect().right-wordmark.getBoundingClientRect().right),
        linkBg:getComputedStyle(open).backgroundColor}
    })
    assert.equal(panelStyle.border,'0px','Logo do painel sem contorno/caixa')
    assert.equal(panelStyle.bg,'rgba(0, 0, 0, 0)','Logo do painel sem fundo em caixa')
    assert(panelStyle.endOffset<3,'Nome alinhado ao X da marca: '+JSON.stringify(panelStyle))
    assert.equal(panelStyle.linkBg,'rgb(242, 92, 5)','Abrir loja deve ser laranja')
    await context.close()
  }

  // Inter-front contract: compact bootstrap returns products:[] even for an existing store.
  const existing = await browser.newContext({viewport:{width:390,height:844}})
  await existing.route('**/api/admin/bootstrap*',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({
      ...bootstrap,
      store:{...bootstrap.store,id:'store-with-products',onboarding_palette_selected:false},
      products:[],productCount:5,productCategories:[{category:'Blusas',count:5}],
    }),
  }))
  const page = await existing.newPage()
  await page.goto('http://127.0.0.1:5173/painel')
  await page.getByRole('heading',{name:/Laura/}).waitFor()
  assert.equal(await page.locator('.svx-onboarding').count(),0,
    'A Frente 03 não pode exibir primeira configuração quando productCount>0 e products=[]')
  assert.match(await page.locator('.panel-nav').innerText(),/Produtos\s*5/)
  await existing.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_DASHBOARD_GREETING_OK')
