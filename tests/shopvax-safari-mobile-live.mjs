import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { webkit, devices } from 'playwright'

const base = 'https://shopvax.com.br'
const dir = 'artifacts/shopvax-safari-mobile'
mkdirSync(dir,{recursive:true})
const report={origin:base,checkedAt:new Date().toISOString(),results:[],errors:[]}
const browser=await webkit.launch({headless:true})
const phone=devices['iPhone 13']
function box(selector) {
  const el=document.querySelector(selector)
  if(!el)return null
  const b=el.getBoundingClientRect(),s=getComputedStyle(el)
  return {x:Math.round(b.x*10)/10,y:Math.round(b.y*10)/10,
    width:Math.round(b.width*10)/10,height:Math.round(b.height*10)/10,
    bottom:Math.round(b.bottom*10)/10,right:Math.round(b.right*10)/10,
    borderRadius:s.borderRadius,objectFit:s.objectFit,position:s.position}
}
try {
  for(const [width,height] of [[375,667],[390,844],[430,932]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:3,isMobile:true,hasTouch:true,
      userAgent:phone.userAgent,locale:'pt-BR'})
    const page=await context.newPage()
    const current={viewport:{width,height},profile:null,feed:null,store:null,buyer:null,errors:[]}
    page.on('pageerror',e=>current.errors.push(e.message))
    // Perfil real do comprador, inclusive o botão Seguir do print.
    await page.goto(base+'/perfil/sw-moda-feminina',{waitUntil:'domcontentloaded',timeout:25000})
    await page.getByRole('button',{name:'Entrar',exact:true}).waitFor({timeout:12000})
    await page.getByRole('button',{name:'Entrar',exact:true}).tap()
    let dialog=page.getByRole('dialog',{name:'Comprador ou vendedor?'})
    await dialog.waitFor()
    const dims=await page.evaluate(box,'.social-account-choice-dialog')
    const optionCount=await dialog.getByRole('button',{name:/Comprador|Vendedor/}).count()
    assert.equal(optionCount,2,'Escolha deve oferecer ambos os perfis')
    assert(dims && dims.x>=-2 && dims.right<=width+2,'Sheet extrapola tela: '+JSON.stringify(dims))
    assert(dims.bottom>=height-3 && dims.bottom<=height+3,'Sheet deve surgir no rodapé Safari: '+JSON.stringify(dims))
    current.profile={dialog:true,optionCount,geometry:dims}
    await page.screenshot({path:`${dir}/profile-select-${width}.png`})
    await dialog.getByRole('button',{name:'Fechar'}).tap()
    await page.getByRole('button',{name:'Seguir',exact:true}).tap()
    dialog=page.getByRole('dialog',{name:'Comprador ou vendedor?'})
    await dialog.waitFor()
    current.profile.followRequiresAccount=(await dialog.innerText()).includes('Para seguir esta loja')
    assert(current.profile.followRequiresAccount,'Seguir deve solicitar login')
    await page.screenshot({path:`${dir}/profile-follow-${width}.png`})

    // Feed: não pode existir moldura nem nome do lojista sobreposto.
    await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:25000})
    await page.locator('.social-feed-card').first().waitFor({timeout:14000})
    const measures=await page.evaluate(()=>{
      const e=(q)=>document.querySelector(q)
      const rect=(q)=>{const n=e(q);if(!n)return null;const b=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,radius:s.borderRadius,fit:s.objectFit}}
      return {card:rect('.social-feed-card'),media:rect('.social-feed-media'),avatar:rect('.social-feed-actions .social-feed-store'),
        cover:rect('.social-feed-media img'),storeNameOverlay:document.querySelectorAll('.social-feed-store-name').length,
        scrollWidth:document.documentElement.scrollWidth}
    })
    assert(Math.abs(measures.card.width-width)<3 && Math.abs(measures.card.x)<3,'Feed Safari com margem lateral: '+JSON.stringify(measures))
    assert(Math.abs(measures.media.width-width)<3,'Mídia Safari sem largura de tela: '+JSON.stringify(measures))
    assert.equal(measures.storeNameOverlay,0,'Nome não deve sobrepor a imagem')
    assert.equal(measures.avatar.radius,'50%','Foto da loja precisa ser redonda')
    assert(measures.scrollWidth<=width+2,'Rolagem horizontal no feed')
    current.feed=measures
    await page.screenshot({path:`${dir}/feed-${width}.png`})

    // Loja: a capa deve alcançar o viewport e o menu abrir sem duplicar botões.
    await page.goto(base+'/sw-moda-feminina',{waitUntil:'domcontentloaded',timeout:25000})
    await page.locator('.store-intro.svx-vitrine').waitFor({timeout:14000})
    const cover=await page.locator('.store-intro.svx-vitrine').boundingBox()
    assert(cover && Math.abs(cover.x)<3 && Math.abs(cover.width-width)<3,
      'Capa da loja Safari com margens: '+JSON.stringify(cover))
    const toggle=page.locator('.store-nav-toggle')
    await toggle.tap()
    const nav=page.locator('.store-header-navigation')
    await nav.waitFor()
    assert(await nav.isVisible(),'Menu mobile nao abriu')
    assert.equal(await nav.getByRole('button',{name:'Feed',exact:true}).count(),1,'Feed duplicado')
    current.store={cover:{x:cover.x,width:cover.width},menu:true}
    await page.screenshot({path:`${dir}/store-menu-${width}.png`})

    // Conta comprador: formulário antigo de senha não deve ser principal.
    await page.goto(base+'/cliente/sw-moda-feminina',{waitUntil:'domcontentloaded',timeout:25000})
    const auth=page.locator('.buyer-auth-entry')
    await auth.waitFor({timeout:14000})
    current.buyer={whatsappEntry:await auth.locator('.buyer-whatsapp-auth').count(),
      legacyHidden:!(await page.getByLabel('Senha antiga').isVisible().catch(()=>false))}
    assert(current.buyer.whatsappEntry===1,'Falta entrada por WhatsApp para comprador')
    assert(current.buyer.legacyHidden,'Campo de senha legada nao pode ser o principal')
    await page.screenshot({path:`${dir}/buyer-${width}.png`})
    assert.deepEqual(current.errors,[],'Erros JavaScript em iPhone WebKit')
    report.results.push(current)
    await context.close()
  }
  report.passed=true
  console.log('SHOPVAX_SAFARI_MOBILE_PASS '+JSON.stringify(report))
} catch(error) {
  report.passed=false;report.errors.push(String(error))
  console.error('SHOPVAX_SAFARI_MOBILE_FAIL '+JSON.stringify(report))
  process.exitCode=1
} finally {
  writeFileSync(dir+'/report.json',JSON.stringify(report,null,2))
  await browser.close()
}
