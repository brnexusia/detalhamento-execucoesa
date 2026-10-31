import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const base = 'http://127.0.0.1:5173'
mkdirSync('artifacts/shopvax-growth', { recursive: true })
const browser = await chromium.launch({ headless:true })
try {
  for (const [width,height] of [[390,844],[1366,768]]) {
    const context = await browser.newContext({ viewport:{ width,height } })
    const page = await context.newPage()
    await page.route('**/api/public/support/config', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({ticketsEnabled:false,aiEnabled:false}) }))
    // Bootstrap can use ?compact=1 once Frente 06 is integrated.
    await page.route('**/api/admin/bootstrap**', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({
      user:{id:'owner1',email:'owner@example.test',name:'Laura'},
      store:{id:'store1',slug:'loja-teste',name:'Loja Teste',whatsapp:'5511999999999',onboarding_palette_selected:true,minimum_order:100,accent:'#F25C05',is_active:true,plan_tier:'bronze'},
      products:[],productCount:0,productCategories:[],sellers:[],orders:[],stats:{views:0,carts:0,orders:0,value:0},
    }) }))
    await page.route('**/api/admin/growth/onboarding', route => route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({identity:true,sellers:false,products:false,minimumOrder:100,confirmed:[]}),
    }))
    await page.goto(base + '/painel')
    await page.getByRole('heading',{name:'Prepare sua loja'}).waitFor()
    // The guide fetches verified onboarding progress asynchronously; wait for the real UI state.
    await page.getByText('1 de 6 etapas verificadas').waitFor({ timeout: 15000 })
    assert.match(await page.locator('.svx-growth-guide').innerText(), /1 de 6 etapas verificadas/)
    assert.match(await page.locator('.svx-growth-guide__current').innerText(), /Primeira vendedora/i)
    await page.getByRole('button',{name:'Precisa de ajuda?'}).click()
    await page.getByRole('heading',{name:'Ajuda para lojistas'}).waitFor()
    assert.match(await page.locator('.svx-support__disabled').innerText(), /não foi ativado/)
    await page.screenshot({path:'artifacts/shopvax-growth/merchant-'+width+'.png'})
    const outside = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 3)
    assert.equal(outside,false,'Sem overflow horizontal no painel')
    await page.close()

    const buyerPage = await context.newPage()
    await buyerPage.route('**/api/public/store/loja-teste/phase2-config', route => route.fulfill({
      status:200, contentType:'application/json', body:JSON.stringify({store:{slug:'loja-teste',name:'Loja Teste',accent:'#F25C05'},customerLoginEnabled:true}),
    }))
    await buyerPage.route('**/api/public/store/loja-teste/customers/me', route => route.fulfill({
      status:200, contentType:'application/json', body:JSON.stringify({customer:{id:'buyer1',name:'Maria',email:'maria@example.test',phone:''},store:{slug:'loja-teste',name:'Loja Teste'},orders:[],semantics:'Pedidos registrados não provam venda.'}),
    }))
    await buyerPage.route('**/api/public/growth/stores', route => route.fulfill({
      status:200, contentType:'application/json', body:JSON.stringify({stores:[{id:'store1',slug:'loja-teste',name:'Loja Teste'}]}),
    }))
    let saved = { whatsapp:false,email:false,scope:'selected',storeIds:[],updatedAt:null }
    await buyerPage.route('**/api/public/store/loja-teste/growth/consent', async route => {
      const method = route.request().method()
      if (method === 'PUT') saved = { ...JSON.parse(route.request().postData() || '{}'), updatedAt:new Date().toISOString() }
      if (method === 'DELETE') saved = { whatsapp:false,email:false,scope:'selected',storeIds:[],updatedAt:new Date().toISOString() }
      await route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(saved) })
    })
    await buyerPage.route('**/api/public/support/config', route => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify({ticketsEnabled:false}) }))
    await buyerPage.goto(base + '/cliente/loja-teste')
    await buyerPage.getByRole('heading',{name:'Preferências de ofertas'}).waitFor()
    const preference = buyerPage.locator('.svx-buyer-preferences')
    assert.equal(await preference.getByLabel('Ofertas por WhatsApp').isChecked(), false)
    assert.equal(await preference.getByLabel('Ofertas por e-mail').isChecked(), false)
    await preference.getByLabel('Ofertas por WhatsApp').check()
    await preference.getByLabel('Quero selecionar lojas').check()
    await preference.getByLabel('Loja Teste').check()
    await preference.getByRole('button',{name:'Salvar minhas preferências'}).click()
    await preference.getByText(/Suas escolhas foram registradas/).waitFor()
    assert.equal(saved.whatsapp,true)
    assert.equal(saved.email,false)
    await preference.getByRole('button',{name:'Cancelar todas as ofertas'}).click()
    await preference.getByText(/Permissões canceladas/).waitFor()
    assert.equal(saved.whatsapp,false)
    assert.equal(saved.email,false)
    await buyerPage.screenshot({path:'artifacts/shopvax-growth/buyer-'+width+'.png'})
    const buyerOverflow = await buyerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 3)
    assert.equal(buyerOverflow,false,'Sem overflow horizontal no comprador')
    await context.close()
  }
} finally { await browser.close() }
console.log('SHOPVAX_GROWTH_BROWSER_OK')
