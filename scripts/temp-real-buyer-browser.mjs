import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {chromium,devices} from 'playwright'
const origin=process.env.BASE_URL
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.equal(origin,'http://127.0.0.1:3000')
const fixture=JSON.parse(await readFile('/tmp/shopvax-real-buyer-fixtures.json','utf8'))
const slug=fixture.stores[0].slug
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const reports=[]
await mkdir('/tmp/real-buyer-browser',{recursive:true})
try{
 for(const mode of ['desktop','mobile']){
  const context=await browser.newContext(mode==='mobile'
    ? {...devices['iPhone 13'],baseURL:origin}
    : {viewport:{width:1440,height:900},baseURL:origin})
  const page=await context.newPage()
  const failures=[]
  await context.route('**/*',async route=>{
   const url=route.request().url()
   if(url.startsWith(origin+'/'))await route.continue()
   else await route.abort('blockedbyclient')
  })
  page.on('pageerror',e=>failures.push(String(e).slice(0,200)))
  const report={mode,slug,scroll:false,openedProduct:false,cart:false,preparedOrder:false,
    whatsappURL:false,errors:failures}
  try{
   const resp=await page.goto('/'+encodeURIComponent(slug),{waitUntil:'domcontentloaded',timeout:22000})
   assert.equal(resp?.status(),200)
   await page.locator('.product-card').first().waitFor({timeout:20000})
   assert.ok(await page.locator('.product-card').count()>=12)
   // Real visitors can close the optional buyer-account promotion.
   // Wait for the async guest-profile check so it cannot appear mid-click.
   await page.locator('.svx-acquisition').waitFor({state:'visible',timeout:3000}).catch(()=>{})
   const closeOffer=page.getByRole('button',{name:'Fechar convite'})
   if(await closeOffer.isVisible()) {
     await closeOffer.click()
     report.dismissedOptionalOffer=true
   }
   await page.evaluate(()=>window.scrollBy(0,Math.max(850,innerHeight*1.6)))
   await page.waitForTimeout(500)
   report.scroll=await page.evaluate(()=>window.scrollY>0)
   await page.locator('.product-card__media').first().click()
   await page.locator('.picker-add').waitFor({timeout:10000})
   report.openedProduct=true
   if(await closeOffer.isVisible())await closeOffer.click()
   await page.locator('.picker-add').click()
   const cart=mode==='mobile'?page.locator('.mobile-cart'):page.locator('.cart-trigger')
   if(await closeOffer.isVisible())await closeOffer.click()
   await cart.click({timeout:10000})
   await page.locator('.cart-item').first().waitFor({timeout:10000})
   report.cart=true
   if(await closeOffer.isVisible())await closeOffer.click()
   await page.locator('.whatsapp-button').click({timeout:10000})
   await page.getByRole('button',{name:/Preparar pedido para enviar/}).click()
   await page.locator('.svx-order-ready__send').waitFor({timeout:12000})
   const link=await page.locator('.svx-order-ready__send').getAttribute('href')
   assert.ok(link?.startsWith('https://wa.me/5511000000000?text='))
   report.preparedOrder=true
   report.whatsappURL=link.startsWith('https://wa.me/')
   report.messageLength=decodeURIComponent(link.split('?text=')[1]||'').length
   await page.screenshot({path:'/tmp/real-buyer-browser/'+mode+'-ready.png',fullPage:false})
  }catch(error){
   report.error=String(error?.message||error).slice(0,700)
   await page.screenshot({path:'/tmp/real-buyer-browser/'+mode+'-failure.png'}).catch(()=>{})
  }finally{
   reports.push(report)
   await context.close()
  }
 }
}finally{await browser.close()}
await writeFile('/tmp/real-buyer-browser.json',JSON.stringify(reports,null,2))
for(const r of reports)console.log('REAL_BROWSER_JOURNEY '+JSON.stringify(r))
if(reports.some(r=>!r.scroll||!r.openedProduct||!r.cart||!r.preparedOrder||!r.whatsappURL))process.exitCode=1
