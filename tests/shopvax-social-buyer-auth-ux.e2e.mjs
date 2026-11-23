import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({headless:true})
const json = (body,status=200) => ({status,contentType:'application/json',body:JSON.stringify(body)})
try {
  for (const width of [390,1280]) {
    const context = await browser.newContext({viewport:{width,height:850}})
    let sessionStatus = 503
    let ownerStatus = 401
    const page = await context.newPage()
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'share',{configurable:true,value:undefined})
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
        writeText:async value=>{window.__shopvaxSharedUrl=value}
      }})
    })
    await page.route('**/api/billing/status',route=>route.fulfill(json({required:false,accessGranted:true})))
    await page.route('**/api/public/buyer-auth/me',route=>
      route.fulfill(sessionStatus===200?json({buyer:{id:'buyer-1',name:'Teste',phone:'5571999999999',profileCompleted:true}}):
        json({error:sessionStatus===503?'Serviço indisponível.':'Entre com seu WhatsApp.'},sessionStatus)))
    await page.route('**/api/auth/me',route=>route.fulfill(json({error:'Sem sessão.'},ownerStatus)))
    await page.route('**/api/social/stores/loja-teste',route=>route.fulfill(json({
      store:{id:'store-1',slug:'loja-teste',name:'Loja Teste',tagline:'Acessórios',eyebrow:'Atacado',logoUrl:'',accent:'#F25C05',planTier:'ouro',productCount:1},
      stats:{followers:0,views:1,following:false},
    })))
    await page.route('**/api/social/stores/loja-teste/publications',route=>route.fulfill(json({publications:[{
      id:'produto-1',name:'Pulseira da coleção',description:'Peça de teste',category:'Pulseiras',
      sku:'TESTE-1',price:null,images:[],mediaUrl:'',mediaType:'image',variations:[],publishedAt:new Date().toISOString(),
    }]})))
    await page.goto('http://127.0.0.1:5173/perfil/loja-teste?produto=produto-1')
    await page.getByRole('button',{name:'Ver preço / Comprar'}).click()
    await page.getByRole('heading',{name:'Preços indisponíveis'}).waitFor()
    assert.match(await page.locator('.svx-social-shop').innerText(),/acesso aos preços está indisponível/)
    assert.equal(await page.locator('.svx-social-shop').getByRole('button',{name:'Tentar novamente'}).count(),1)
    assert.equal(await page.locator('.svx-social-shop').getByRole('button',{name:'Voltar aos produtos'}).count(),1)
    assert.equal(await page.locator('.svx-social-shop').getByRole('heading',{name:'Entrar com WhatsApp'}).count(),0)

    // A API de comprador responde 401 e a sessão opcional de lojista fica 503.
    // Isso deve oferecer o formulário de comprador, não travar no erro genérico.
    sessionStatus = 401
    ownerStatus = 503
    await page.locator('.svx-social-shop').getByRole('button',{name:'Tentar novamente'}).click()
    await page.locator('.svx-social-shop').getByRole('heading',{name:'Entrar com WhatsApp'}).waitFor()
    assert.equal(await page.locator('.svx-social-shop').getByRole('button',{name:'Receber código no WhatsApp'}).count(),1)
    assert.match(await page.locator('.svx-social-shop').innerText(),/Depois você volta a este produto/)

    await page.locator('.svx-social-shop').getByRole('button',{name:'Fechar'}).click()
    // Product details overlay remains open after checkout closes. Close it
    // before using the profile share action (avoids a hidden click).
    await page.locator('.social-profile-viewer__close').click()
    await page.getByRole('button',{name:'Compartilhar perfil com link oficial'}).click()
    await page.getByText('Link oficial da ShopVax copiado.').waitFor()
    assert.equal(await page.evaluate(()=>window.__shopvaxSharedUrl),'https://shopvax.com.br/perfil/loja-teste')
    const horizontalOverflow = await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2)
    assert.equal(horizontalOverflow,false,'Sem rolagem horizontal em '+width)
    console.log('SHOPVAX_SOCIAL_BUYER_AUTH_UX_PASS',width)
    await context.close()
  }
} finally {
  await browser.close()
}
