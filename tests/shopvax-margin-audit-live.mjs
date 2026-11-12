import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import crypto from 'node:crypto'

const origin = String(process.env.SHOPVAX_ORIGIN || 'https://shopvax.com.br').replace(/\/$/, '')
const out = 'artifacts/shopvax-margin-audit'
mkdirSync(out, { recursive: true })
const routes = [
  '/', '/feed', '/buscar', '/salvos', '/carrinhos', '/comprador',
  '/para-lojas', '/entrar', '/criar-conta', '/parceiros', '/parceiros/entrar',
  '/parceiros/cadastro', '/cliente',
  '/perfil/galego-bijux', '/perfil/sw-moda-feminina', '/perfil/alexandre-bijoux',
  '/galego-bijux', '/galego-bijux?catalog=geral', '/galego-bijux?catalog=atacado',
  '/sw-moda-feminina', '/alexandre-bijoux',
  '/painel', '/painel/produtos', '/painel/pedidos', '/painel/vendedoras',
  '/painel/loja', '/painel/temas', '/painel/assinatura',
  '/painel/recursos', '/painel/integracoes', '/painel/operacao',
  '/painel/relatorios', '/painel/crescimento', '/admin',
]
const profiles = [
  { name:'mobile-portrait', width:390, height:844, deviceScaleFactor:2, isMobile:true, hasTouch:true },
  { name:'mobile-landscape', width:844, height:390, deviceScaleFactor:2, isMobile:true, hasTouch:true },
  { name:'desktop', width:1440, height:900, deviceScaleFactor:1, isMobile:false, hasTouch:false },
]
function safeName(route) { return (route.replace(/[^a-z0-9]/gi,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'home').slice(0,70) }
const browser = await chromium.launch({headless:true, args:['--no-sandbox']})
const report = { checkedAt: new Date().toISOString(), origin, profiles, results:[], signup:null, errors:[] }
try {
 for (const profile of profiles) {
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.deviceScaleFactor,isMobile:profile.isMobile,hasTouch:profile.hasTouch,ignoreHTTPSErrors:false})
  const page=await context.newPage()
  for (const route of routes) {
   let status=null, navigationError=null, actual='', title='', metrics=null
   const issues=[]
   try {
    const response=await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:25000})
    status=response?.status()??null
    await page.waitForTimeout(650)
    actual=new URL(page.url()).pathname
    title=(await page.title()).slice(0,110)
    metrics=await page.evaluate(()=>{
     const doc=document.documentElement
     const vw=innerWidth
     const total=Math.max(doc.scrollWidth,document.body?.scrollWidth||0)
     const targets=['main','section','article','header','footer','nav','form','input','button','a','select','textarea','[role="dialog"]','.svx-catalog-inline__cards','.svx-catalog-card']
     const seen=new Set()
     const clipped=[]
     const visible=el=>{
       const c=getComputedStyle(el),r=el.getBoundingClientRect()
       return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)>0
         &&r.height>3&&r.width>3&&r.top<innerHeight+40&&r.bottom>-40
         &&el.getAttribute('aria-hidden')!=='true'
     }
     function expectedHorizontalScroll(el){
       let parent=el.parentElement
       while(parent && parent!==document.body){
         const style=getComputedStyle(parent)
         if(['auto','scroll'].includes(style.overflowX) && parent.scrollWidth>parent.clientWidth+4)return true
         parent=parent.parentElement
       }
       return false
     }
     for(const el of document.querySelectorAll(targets.join(','))){
       if(seen.has(el)||!visible(el)||expectedHorizontalScroll(el))continue
       seen.add(el)
       const r=el.getBoundingClientRect()
       if(r.left>=-6 && r.right<=vw+6)continue
       // Registra apenas elementos que não estão num carrossel rolável explícito.
       clipped.push({
         tag:el.tagName.toLowerCase(), className:String(el.className||'').slice(0,70),
         text:String(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,46),
         left:Math.round(r.left),right:Math.round(r.right),
       })
       if(clipped.length>=8)break
     }
     return {viewport:vw,documentWidth:total,overflowPx:Math.max(0,Math.round(total-vw)),
       sampledOutsideViewport:clipped,
       catalogCount:document.querySelectorAll('.svx-catalog-card').length,
     }
    })
    if(metrics.overflowPx>4)issues.push('document-horizontal-overflow')
    if(metrics.sampledOutsideViewport.length)issues.push('visible-elements-outside-viewport')
    if(status>=400)issues.push('http-'+status)
    if(route.startsWith('/painel')&&actual==='/entrar')issues.push('requires-merchant-login')
    await page.screenshot({path:`${out}/${profile.name}-${safeName(route)}.png`,fullPage:false,animations:'disabled',timeout:15000})
   } catch(error) {
    navigationError=String(error?.message||error).slice(0,250)
    issues.push('navigation-or-measurement-error')
   }
   const entry={profile:profile.name,route,status,actual,title,metrics,issues,navigationError}
   report.results.push(entry)
   console.log('PAGE_AUDIT '+JSON.stringify(entry))
  }
  await context.close()
 }
 // ÚNICO cadastro de teste em produção, sem preencher checkout ou pagar.
 // A senha aleatória fica somente na memória da execução; nunca é logada.
 const context=await browser.newContext({viewport:{width:1280,height:900}})
 const page=await context.newPage()
 const account={
   email:`qa-layout-${process.env.GITHUB_RUN_ID||Date.now()}@example.com`,
   password:crypto.randomBytes(20).toString('base64url')+'aA!7',
   name:'Auditoria ShopVax',
   store:'ShopVax QA Layout '+String(process.env.GITHUB_RUN_ID||Date.now()).slice(-8),
   phone:'5511999990000'
 }
 const signup={email:account.email,attempted:false,created:false,loginAttempted:false,authenticated:false,paid:false,route:'',observations:[]}
 report.signup=signup
 try{
  await page.goto(origin+'/criar-conta',{waitUntil:'domcontentloaded',timeout:25000})
  await page.getByRole('textbox',{name:'Seu nome'}).fill(account.name,{timeout:5000})
  await page.getByRole('textbox',{name:'Nome da loja'}).fill(account.store,{timeout:5000})
  await page.getByRole('textbox',{name:'WhatsApp principal'}).fill(account.phone,{timeout:5000})
  await page.getByRole('textbox',{name:'E-mail'}).fill(account.email,{timeout:5000})
  await page.getByRole('textbox',{name:/Senha/}).fill(account.password,{timeout:5000})
  signup.attempted=true
  await page.getByRole('button',{name:/Continuar para pagamento/}).click({timeout:5000})
  await page.waitForTimeout(3200)
  signup.route=page.url().replace(account.email,'[email]')
  signup.observations.push('Após enviar cadastro: '+new URL(page.url()).hostname+new URL(page.url()).pathname)
  signup.created=page.url().includes('checkout.stripe.com')||page.url().includes('/painel')||page.url().includes('billing')
  if(page.url().includes('stripe.com'))signup.observations.push('Checkout aberto, nenhuma compra foi concluída.')
  await page.screenshot({path:out+'/signup-result.png',fullPage:false,timeout:15000})
  // Testar login do novo lojista sem completar pagamento; máximo de uma tentativa.
  await page.goto(origin+'/entrar',{waitUntil:'domcontentloaded',timeout:25000})
  await page.getByRole('textbox',{name:'E-mail'}).fill(account.email,{timeout:5000})
  await page.getByRole('textbox',{name:/Senha/}).fill(account.password,{timeout:5000})
  signup.loginAttempted=true
  await page.getByRole('button',{name:'Entrar',exact:true}).click({timeout:5000})
  await page.waitForTimeout(2300)
  const loginLocation=new URL(page.url())
  signup.observations.push('Após login: '+loginLocation.hostname+loginLocation.pathname)
  if(loginLocation.pathname.startsWith('/painel')){
    signup.authenticated=true
    const response=await page.goto(origin+'/painel/produtos',{waitUntil:'domcontentloaded',timeout:25000})
    await page.waitForTimeout(1700)
    signup.observations.push('Painel de produtos: '+String(response?.status()||'?')+' '+new URL(page.url()).pathname)
    await page.screenshot({path:out+'/merchant-products.png',fullPage:false,timeout:15000})
  }
 }catch(error){
  signup.observations.push('Fluxo interrompido: '+String(error?.message||error).slice(0,300))
 }
 await context.close()
} finally {
 writeFileSync(out+'/report.json',JSON.stringify(report,null,2))
 const issues=report.results.filter(x=>x.issues.length && !x.issues.every(i=>i==='requires-merchant-login'))
 console.log('SHOPVAX_MARGIN_SUMMARY '+JSON.stringify({total:report.results.length,problemPages:issues.length,details:issues.map(x=>({profile:x.profile,route:x.route,status:x.status,overflow:x.metrics?.overflowPx,outside:x.metrics?.sampledOutsideViewport?.slice(0,3),issues:x.issues})),signup:report.signup}))
 await browser.close()
}
