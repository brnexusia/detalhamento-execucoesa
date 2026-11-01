import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'

// Testa o DOM e os estilos COMPUTADOS; não apenas a presença de CSS no repositório.
const browserType = process.env.SHOPVAX_TEST_BROWSER === 'webkit' ? webkit : chromium
const browser = await browserType.launch({ headless: true })
const out = 'artifacts/shopvax-feedback'
mkdirSync(out, { recursive: true })

const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="900" viewBox="0 0 500 900"><rect width="500" height="900" fill="#ddac77"/><rect x="70" y="130" width="360" height="650" rx="45" fill="#a35e2e"/></svg>'
const product = {
  id:'p1',sku:'SKU-1',name:'Conjunto de brincos dourados',
  description:'Conjunto de brincos para revenda.',category:'Brincos',
  price:34,mediaUrl:'/shopvax-test-product.svg',mediaType:'image',images:[],
  publishedAt:'2026-11-01T00:00:00.000Z',variations:[],
}
const store = { id:'s1',slug:'loja-teste',name:'Loja Teste',eyebrow:'Atacado',
  tagline:'Escolha suas peças e envie seu pedido.',minimumOrder:400,
  whatsapp:'5571999999999',logoUrl:'',accent:'#e5ac14',planTier:'prata',
}
const post = {id:'post1',store,product,interactions:{
  views:9,likes:0,shares:0,followers:0,liked:false,following:false,
}}

try {
  for (const width of [390, 430, 1440]) {
    const page = await browser.newPage({ viewport:{width,height:844}, deviceScaleFactor:1 })
    await page.route('**/shopvax-test-product.svg', route => route.fulfill({status:200,contentType:'image/svg+xml',body:photo}))
    await page.route('**/api/social/feed?**', route => route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({posts:[post],page:{hasMore:false,nextCursor:null}}),
    }))
    await page.goto('http://127.0.0.1:5173/feed')
    await page.locator('.social-feed-card').waitFor()
    await page.locator('.social-feed-media img').waitFor()
    const feed = await page.evaluate(() => {
      const rect = (sel) => {
        const e=document.querySelector(sel); const r=e.getBoundingClientRect()
        return {x:r.x,width:r.width,top:r.top,bottom:r.bottom,radius:getComputedStyle(e).borderRadius}
      }
      const avatar=rect('.social-feed-actions .social-feed-store')
      const like=rect('.social-feed-actions button[aria-label="Curtir produto"]')
      const image=document.querySelector('.social-feed-media img')
      const debug=(sel)=>{
        const e=document.querySelector(sel);const s=getComputedStyle(e);const r=e.getBoundingClientRect();
        return {x:r.x,width:r.width,clientWidth:e.clientWidth,offsetWidth:e.offsetWidth,
          paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,maxWidth:s.maxWidth,
          widthCss:s.width,boxSizing:s.boxSizing,transform:s.transform};
      };
      return {
        debug:{page:debug('.social-feed-page'),list:debug('main.social-feed-list'),card:debug('.social-feed-card'),body:debug('body')},
        card:rect('.social-feed-card'),
        media:rect('.social-feed-media'),
        image:rect('.social-feed-media img'),
        avatar,like,
        imageFit:getComputedStyle(image).objectFit,
        aviso:document.body.innerText.includes('Feed recuperado da sessão'),
        overflow:document.documentElement.scrollWidth-innerWidth,
      }
    })
    assert(feed.avatar.top<feed.like.top,'O avatar deve estar acima das curtidas: '+JSON.stringify(feed))
    assert.equal(feed.avatar.radius,'50%','Foto da loja precisa ser circular')
    assert.equal(feed.imageFit,'cover','Foto do feed precisa preencher a publicação')
    assert(!feed.aviso,'O aviso de sessão recuperada não pode ser exibido')
    if(width<800) {
      assert(Math.abs(feed.card.x)<=2 && Math.abs(feed.card.width-width)<=2,
        'Feed mobile deve ir até as duas bordas: '+JSON.stringify(feed))
      assert(Math.abs(feed.media.x)<=2 && Math.abs(feed.media.width-width)<=2,
        'Imagem deve ocupar largura completa sem bordas pretas: '+JSON.stringify(feed))
    } else {
      assert(feed.card.width>400 && feed.card.width<920,
        'No desktop deve haver visualizador vertical central: '+JSON.stringify(feed))
      assert(Math.abs(feed.media.width-feed.card.width)<=2,
        'Nenhum painel lateral opaco pode tirar largura da foto: '+JSON.stringify(feed))
    }
    assert(feed.overflow<=2,'Feed com rolagem lateral: '+JSON.stringify(feed))
    await page.screenshot({path:`${out}/feed-${width}.png`})
    await page.close()
  }

  for(const width of [390,430]) {
    const page = await browser.newPage({ viewport:{width,height:844},deviceScaleFactor:1 })
    await page.route('**/shopvax-test-product.svg', route => route.fulfill({status:200,contentType:'image/svg+xml',body:photo}))
    await page.route('**/api/public/store/loja-teste*',route => route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({store,seller:{slug:'marina',name:'Marina',phone:store.whatsapp},
        products:[product],categories:['Brincos'],page:{hasMore:false,nextCursor:null,limit:24}}),
    }))
    await page.route('**/api/public/store/loja-teste/phase2-config',route => route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({
        store:{slug:store.slug,name:store.name},customerLoginEnabled:true,
        buyerWhatsAppLoginEnabled:false,theme:{background:'#F3F0E8',textColor:'#161514',font:'system'},
      }),
    }))
    await page.route('**/api/public/store/loja-teste/customers/me',route => route.fulfill({
      status:401,contentType:'application/json',body:'{"error":"Não autenticado"}',
    }))
    await page.route('**/api/public/commercial-config/loja-teste',route => route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({
        paymentMethods:[{key:'pix',label:'Pix'}],deliveryMethods:[{key:'envio',label:'Envio por transportadora'}],
        note:'Condições a combinar.',informationalOnly:true,disclaimer:'Confirme com a vendedora.',
      }),
    }))
    await page.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
    await page.goto('http://127.0.0.1:5173/loja-teste')
    await page.locator('.store-intro.svx-vitrine').waitFor()
    const hero=await page.locator('.store-intro.svx-vitrine').boundingBox()
    assert(hero && Math.abs(hero.x)<=2 && Math.abs(hero.width-width)<=2,
      'Capa da loja deve ter largura completa: '+JSON.stringify(hero))
    const menu=page.locator('.store-nav-toggle')
    await menu.click()
    const nav=page.locator('.store-header-navigation')
    assert(await nav.isVisible(),'Menu da loja deve abrir')
    assert.equal(await nav.getByRole('button',{name:'Feed',exact:true}).count(),1,'Não duplicar Feed')
    assert.equal(await nav.getByRole('button',{name:'Perfil',exact:true}).count(),1,'Não duplicar Perfil')
    assert.equal(await nav.getByRole('button',{name:'Loja',exact:true}).count(),1,'Não duplicar Loja')
    assert.equal(await nav.getByRole('button',{name:'Entrar',exact:true}).count(),1,'Não duplicar Entrar')
    const navBox=await nav.boundingBox()
    assert(navBox && navBox.x>=0 && navBox.x+navBox.width<=width+2,'Menu corta na borda: '+JSON.stringify(navBox))
    await page.screenshot({path:`${out}/menu-loja-${width}.png`})
    await menu.click()
    const commercial=page.locator('details.svx-commercial-info')
    await commercial.waitFor()
    const position=await commercial.evaluate(el=>getComputedStyle(el).position)
    assert.notEqual(position,'fixed','Pagamento e entrega não deve cobrir a vitrine')
    assert.equal(await page.locator('#atacado-commercial-info').count(),0,'Widget flutuante antigo presente')
    await commercial.locator('summary').click()
    await commercial.getByText('Pix').waitFor()
    await page.screenshot({path:`${out}/pagamento-${width}.png`})
    await page.close()
  }

  const page=await browser.newPage({viewport:{width:390,height:844}})
  await page.route('**/api/public/store/loja-teste/phase2-config',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({store:{slug:store.slug,name:store.name},
      customerLoginEnabled:true,buyerWhatsAppLoginEnabled:true}),
  }))
  await page.route('**/api/public/store/loja-teste/customers/me',route=>route.fulfill({
    status:401,contentType:'application/json',body:'{"error":"Não autenticado"}',
  }))
  await page.route('**/api/public/buyer-auth/me',route=>route.fulfill({
    status:401,contentType:'application/json',body:'{"error":"Sem sessão"}',
  }))
  await page.goto('http://127.0.0.1:5173/cliente/loja-teste')
  await page.getByRole('heading',{name:'Entrar com WhatsApp'}).waitFor()
  assert.equal(await page.getByLabel('Senha').count(),0,'O comprador não deve precisar criar senha')
  await page.getByRole('button',{name:/Receber código no WhatsApp/}).waitFor()
  await page.screenshot({path:`${out}/comprador-entrada.png`})
  await page.unroute('**/api/public/buyer-auth/me')
  await page.route('**/api/public/buyer-auth/me',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({buyer:{
      phone:'5571999999999',name:'',email:'',purpose:'',city:'',state:'',
      businessStatus:'',businessName:'',cnpjStatus:'',cnpj:'',
      channels:[],segment:'',instagram:'',profileCompleted:false,marketingConsent:false,
    }}),
  }))
  await page.reload()
  await page.getByRole('heading',{name:'Seu perfil de comprador'}).waitFor()
  await page.getByLabel('Qual é a finalidade das suas compras? *').waitFor()
  await page.getByLabel('Qual é a finalidade das suas compras? *').selectOption('revenda')
  await page.getByText('Você possui um negócio?').waitFor()
  await page.getByText('Possui CNPJ?').waitFor()
  await page.getByText('Onde vende ou pretende vender?').waitFor()
  assert.equal(await page.getByLabel('Senha').count(),0)
  await page.screenshot({path:`${out}/comprador-perguntas.png`,fullPage:true})
  await page.goto('http://127.0.0.1:5173/criar-conta')
  await page.getByPlaceholder('Loja').waitFor()
  await page.getByPlaceholder('Ex.: Atacado Aurora').waitFor()
  await page.locator('.auth-register-brand .svx-brand-wordmark').waitFor()
  await page.screenshot({path:`${out}/lojista-cadastro.png`,fullPage:true})
  await page.close()
  // Perfil: tocar em Entrar deve diferenciar comprador e vendedor.
  // Seguir não pode mudar de estado anonimamente, e precisa exibir a mesma escolha.
  {
    const page = await browser.newPage({viewport:{width:390,height:844}})
    await page.route('**/api/social/stores/loja-teste/publications', r => r.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({publications:[product]}),
    }))
    await page.route('**/api/social/stores/loja-teste', r => r.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({
        store:{...store,productCount:1},stats:{followers:0,views:13,following:false},
      }),
    }))
    let followAuthenticated = false
    await page.route('**/api/social/stores/s1/follow', r => r.fulfill({
      status:followAuthenticated?200:401,contentType:'application/json',
      body:JSON.stringify(followAuthenticated
        ? {following:true,followers:1}
        : {code:'AUTH_REQUIRED',error:'Entre como comprador ou vendedor para seguir lojas.'}),
    }))
    await page.goto('http://127.0.0.1:5173/perfil/loja-teste')
    await page.getByRole('heading',{name:'Loja Teste'}).waitFor()
    await page.getByRole('button',{name:'Entrar',exact:true}).click()
    let dialog=page.getByRole('dialog',{name:'Comprador ou vendedor?'})
    await dialog.waitFor()
    const mobileSheet=await dialog.boundingBox()
    assert(mobileSheet && mobileSheet.x>=-2 && mobileSheet.x+mobileSheet.width<=392,'Modal de conta não pode ultrapassar tela mobile')
    if(process.env.SHOPVAX_TEST_BROWSER === 'webkit') {
      assert(Math.abs(mobileSheet.x)<=2 && mobileSheet.width>=388,'WebKit iOS requer seleção de conta em largura completa')
      assert(Math.abs(mobileSheet.y+mobileSheet.height-844)<=3,'WebKit iOS requer painel alinhado ao rodapé')
    }
    assert.equal(await dialog.getByRole('button',{name:/Comprador/}).count(),1)
    assert.equal(await dialog.getByRole('button',{name:/Vendedor/}).count(),1)
    await page.screenshot({path:`${out}/perfil-escolha-conta.png`})
    await dialog.getByRole('button',{name:'Fechar'}).click()
    await page.getByRole('button',{name:'Seguir',exact:true}).click()
    dialog=page.getByRole('dialog',{name:'Comprador ou vendedor?'})
    await dialog.waitFor()
    assert.match(await dialog.innerText(),/Para seguir esta loja/)
    await dialog.getByRole('button',{name:/Comprador/}).click()
    await page.waitForURL('**/cliente/loja-teste?next=*')
    assert.equal(new URL(page.url()).searchParams.get('next'),'/perfil/loja-teste')
    await page.goto('http://127.0.0.1:5173/perfil/loja-teste')
    await page.getByRole('button',{name:'Entrar',exact:true}).click()
    await page.getByRole('dialog',{name:'Comprador ou vendedor?'}).getByRole('button',{name:/Vendedor/}).click()
    await page.waitForURL('**/entrar?next=*')
    assert.equal(new URL(page.url()).searchParams.get('next'),'/perfil/loja-teste')
    followAuthenticated=true
    await page.goto('http://127.0.0.1:5173/perfil/loja-teste')
    await page.getByRole('button',{name:'Seguir',exact:true}).click()
    await page.getByRole('button',{name:'Seguindo',exact:true}).waitFor()
    assert.equal(await page.getByRole('dialog').count(),0,'Conta autenticada não precisa escolher novamente')
    await page.close()
  }

  console.log('SHOPVAX_FEEDBACK_UI_E2E_PASS: feed, margens, loja, menu, pagamentos, cadastro')
} finally {
  await browser.close()
}
