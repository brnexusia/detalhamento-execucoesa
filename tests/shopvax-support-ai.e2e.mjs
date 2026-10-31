import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({headless:true})
try{
 for(const width of [390,1366]){
  const page=await browser.newPage({viewport:{width,height:844}})
  await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
  await page.route('**/api/public/support/config',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    ticketsEnabled:false,aiEnabled:true,messagingEnabled:false,supportWhatsapp:'5511999999999',
  })}))
  let sent
  await page.route('**/api/public/support/assist',async route=>{
    sent=route.request().postDataJSON()
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      answer:'Escolha produtos, monte a grade e revise o pedido mínimo antes de abrir o WhatsApp.',needsHuman:false,
    })})
  })
  await page.goto('http://127.0.0.1:5173/entrar')
  const open=page.getByRole('button',{name:'Precisa de ajuda?'})
  await open.click()
  const panel=page.locator('#svx-support-panel')
  await panel.getByText('Orientação automática da Shopvax').waitFor()
  const whatsapp=panel.getByRole('link',{name:/central Shopvax pelo WhatsApp/})
  assert.match(await whatsapp.getAttribute('href') || '',/^https:\/\/wa\.me\/5511999999999\?text=/)
  const assistant=panel.locator('.svx-support__ai')
  await assistant.locator('textarea').fill('Como monto um pedido atacadista?')
  await assistant.locator('input[type="checkbox"]').check()
  await assistant.getByRole('button',{name:'Pedir orientação à IA'}).click()
  assert.equal(sent?.audience,'merchant')
  assert.equal(sent?.privacyAcknowledged,true)
  assert.equal(sent?.question,'Como monto um pedido atacadista?')
  await assistant.getByText(/revise o pedido mínimo/).waitFor()
  assert.equal(await panel.locator('.svx-support__disabled').count(),0)
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
  assert(overflow<=2,'Support UI overflow: '+width+' '+overflow)
  await page.close()
 }
}finally{await browser.close()}
console.log('SHOPVAX_CENTRAL_SUPPORT_UI_OK')
