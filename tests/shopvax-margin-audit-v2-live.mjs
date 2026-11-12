import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

// Auditoria de leitura, sem credenciais e sem mutações de estado.
// Testa scroll além do primeiro viewport e ignora drawers ocultos e
// carrosséis com scroll intencional.
const origin = String(process.env.SHOPVAX_ORIGIN || 'https://shopvax.com.br').replace(/\/$/,'')
const dir = 'artifacts/shopvax-margin-recheck'
mkdirSync(dir,{recursive:true})
const routes = [
 '/', '/feed', '/descobrir', '/buscar', '/salvos', '/carrinhos', '/comprador',
 '/para-lojas', '/entrar', '/criar-conta', '/parceiros', '/parceiros/entrar',
 '/parceiros/cadastro', '/cliente', '/perfil/galego-bijux', '/perfil/alexandre-bijoux',
 '/perfil/sw-moda-feminina', '/galego-bijux', '/galego-bijux?catalog=geral',
 '/galego-bijux?catalog=atacado', '/alexandre-bijoux', '/sw-moda-feminina',
 '/painel', '/painel/produtos', '/painel/pedidos', '/painel/vendedoras', '/painel/loja',
 '/painel/temas', '/painel/assinatura', '/painel/recursos',
 '/painel/integracoes', '/painel/operacao', '/painel/relatorios',
 '/painel/crescimento', '/admin',
]
const screens=[
 {name:'mobile-390x844',width:390,height:844,isMobile:true,hasTouch:true},
 {name:'mobile-landscape-844x390',width:844,height:390,isMobile:true,hasTouch:true},
 {name:'tablet-768x1024',width:768,height:1024,isMobile:true,hasTouch:true},
 {name:'desktop-1440x900',width:1440,height:900,isMobile:false,hasTouch:false},
]
const slug=s=>(s.replace(/[^a-z0-9]/gi,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'home').slice(0,72)
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const report={origin,date:new Date().toISOString(),screens,routes,results:[]}
function concise(error){return String(error?.message||error).slice(0,300)}
async function inspect(page,position){
 return page.evaluate((position)=>{
  const doc=document.documentElement,body=document.body
  const vw=window.innerWidth
  const selectors='main,header,footer,section,article,form,input,textarea,select,button,a,[role="dialog"],[role="navigation"],h1,h2,h3,.svx-catalog-inline__cards,.svx-catalog-card'
  const skip=element=>{
   if(element.closest('.cart-drawer:not(.is-open),.drawer-backdrop:not(.is-open),[inert],[hidden],[aria-hidden="true"]'))return true
   let p=element.parentElement
   while(p&&p!==body){
    const style=getComputedStyle(p)
    if(['auto','scroll'].includes(style.overflowX)&&p.scrollWidth>p.clientWidth+3)return true
    p=p.parentElement
   }
   return false
  }
  const offscreen=[]
  for(const el of document.querySelectorAll(selectors)){
   if(skip(el))continue
   const style=getComputedStyle(el)
   if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||style.contentVisibility==='hidden')continue
   const r=el.getBoundingClientRect()
   if(r.height<4||r.width<4||r.bottom<0||r.top>innerHeight)continue
   if(r.right<=vw+5&&r.left>=-5)continue
   offscreen.push({tag:el.tagName.toLowerCase(),className:String(el.className||'').slice(0,55),text:String(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,48),left:Math.round(r.left),right:Math.round(r.right)})
   if(offscreen.length>=8)break
  }
  return {
   position, viewport:vw,documentWidth:Math.max(doc.scrollWidth,body?.scrollWidth||0),
   overflowPx:Math.max(0,Math.round(Math.max(doc.scrollWidth,body?.scrollWidth||0)-vw)),
   offscreen, scrollY:Math.round(window.scrollY), docHeight:Math.max(doc.scrollHeight,body?.scrollHeight||0),
   catalogCards:document.querySelectorAll('.svx-catalog-card').length,
  }
 },position)
}
try{
 for(const config of screens){
  const ctx=await browser.newContext({viewport:{width:config.width,height:config.height},isMobile:config.isMobile,hasTouch:config.hasTouch,deviceScaleFactor:1})
  const page=await ctx.newPage()
  for(const route of routes){
   let status=null,actual='',title='',error=null,checks=[]
   try{
    const response=await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:20000})
    status=response?.status()??null
    await page.waitForTimeout(400)
    actual=new URL(page.url()).pathname
    title=await page.title()
    const dims=await page.evaluate(()=>({h:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),vh:innerHeight}))
    const locations=[{label:'top',y:0},{label:'middle',y:Math.max(0,Math.round((dims.h-dims.vh)/2))},{label:'bottom',y:Math.max(0,dims.h-dims.vh)}]
    const visited=new Set()
    for(const location of locations){
     if(visited.has(location.y))continue
     visited.add(location.y)
     await page.evaluate(y=>window.scrollTo(0,y),location.y)
     await page.waitForTimeout(180)
     checks.push(await inspect(page,location.label))
    }
    await page.evaluate(()=>window.scrollTo(0,0))
    const file=`${dir}/${config.name}-${slug(route)}.png`
    await page.screenshot({path:file,fullPage:false,animations:'disabled',timeout:12000})
   }catch(e){error=concise(e)}
   const issueSet=new Set()
   if(status>=400)issueSet.add('http-'+status)
   if(route.startsWith('/painel')&&actual==='/entrar')issueSet.add('login-required')
   if(error)issueSet.add('navigation-error')
   if(checks.some(x=>x.overflowPx>4))issueSet.add('horizontal-document-overflow')
   if(checks.some(x=>x.offscreen.length>0))issueSet.add('visible-content-outside-screen')
   const item={device:config.name,route,status,actual,title,issues:[...issueSet],samples:checks,error}
   report.results.push(item)
   console.log('AUDIT_V2 '+JSON.stringify({device:config.name,route,status,actual,issues:item.issues,overflow:Math.max(0,...checks.map(x=>x.overflowPx)),offscreen:checks.flatMap(x=>x.offscreen).slice(0,3),error}))
  }
  await ctx.close()
 }
}finally{
 writeFileSync(dir+'/report.json',JSON.stringify(report,null,2))
 const x=report.results
 const problem=x.filter(a=>a.issues.some(i=>!['login-required'].includes(i)))
 console.log('AUDIT_V2_SUMMARY '+JSON.stringify({total:x.length,distinctRoutes:routes.length,screenSizes:screens.map(x=>x.name),problemRoutes:[...new Set(problem.map(x=>x.route))],issues:problem.map(a=>({device:a.device,route:a.route,issues:a.issues,offscreen:a.samples.flatMap(x=>x.offscreen).slice(0,3),maxOverflow:Math.max(0,...a.samples.map(x=>x.overflowPx))})),authRestricted:x.filter(a=>a.issues.includes('login-required')).length}))
 await browser.close()
}
