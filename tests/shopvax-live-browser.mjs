import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const origin = 'https://shopvax.com.br'
const out = 'artifacts/shopvax-live-check'
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true})
const result={origin,checkedAt:new Date().toISOString(),pages:[],errors:[],bundles:[]}
try {
  const page=await browser.newPage({...devices['iPhone 13'],browserName:undefined})
  const bundles=[]
  page.on('response',r=>{
    if(r.url().startsWith(origin+'/assets/') && /\.js($|\?)/.test(r.url())){
      bundles.push({url:r.url().slice(origin.length),status:r.status(),cache:r.headers()['cache-control']})
    }
  })
  page.on('pageerror',err=>result.errors.push(err.message))
  for(const route of ['/perfil/sw-moda-feminina','/']){
    const resp=await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:25000})
    await page.waitForTimeout(3000)
    const entry={route,http:resp?.status(),title:await page.title(),url:page.url(),text:(await page.locator('body').innerText()).slice(0,500)}
    result.pages.push(entry)
    await page.screenshot({path:out+(route==='/'?'/feed.png':'/profile.png'),fullPage:false})
    if(route==='/perfil/sw-moda-feminina'){
      const btn=page.getByRole('button',{name:'Entrar',exact:true})
      entry.enterButtonCount=await btn.count()
      if(await btn.count()){
        await btn.click()
        await page.waitForTimeout(450)
        const modal=page.getByRole('dialog',{name:'Comprador ou vendedor?'})
        entry.choiceVisible=await modal.isVisible()
        entry.dialogCount=await page.getByRole('dialog').count()
        entry.dialogText=entry.choiceVisible?(await modal.innerText()).slice(0,430):''
        await page.screenshot({path:out+'/profile-enter.png',fullPage:false})
        if(entry.choiceVisible){
          await modal.getByRole('button',{name:'Fechar'}).click()
          const follow=page.getByRole('button',{name:'Seguir',exact:true})
          entry.followCount=await follow.count()
          if(await follow.count()){
            await follow.click()
            await page.waitForTimeout(900)
            entry.followPromptVisible=await page.getByRole('dialog',{name:'Comprador ou vendedor?'}).isVisible()
          }
        }
      }
    }
  }
  result.bundles=bundles
  try{
    const v=await page.request.get(origin+'/shopvax-ui-version.json',{timeout:12000})
    result.versionStatus=v.status();result.version=await v.json()
  }catch(err){result.errors.push('version:'+String(err))}
  const ok=result.pages[0]?.http===200 && result.pages[0]?.choiceVisible && result.pages[0]?.followPromptVisible
  result.passed=Boolean(ok)
  console.log('SHOPVAX_LIVE_BROWSER_RESULT '+JSON.stringify(result))
  if(!ok)process.exitCode=1
}finally{
  writeFileSync(out+'/diagnostic.json',JSON.stringify(result,null,2))
  await browser.close()
}
