import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
const path='public/help/shopvax-guide.mp4'
const bytes=await readFile(path)
const stats=await stat(path)
assert(stats.size>=5000 && stats.size<1_000_000,'MP4 precisa ser leve e não vazio')
assert.equal(bytes.toString('ascii',4,8),'ftyp','O arquivo gerado precisa ser MP4')
const browser=await chromium.launch({headless:true})
try {
 for (const width of [390,1366]) {
   const page=await browser.newPage({viewport:{width,height:844}})
   await page.route('**/api/public/auth/google-config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false}'}))
   await page.route('**/api/public/support/config',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ticketsEnabled":false,"aiEnabled":false}'}))
   await page.goto('http://127.0.0.1:5173/entrar')
   await page.getByRole('button',{name:'Precisa de ajuda?'}).click()
   const summary=page.getByText(/Ver vídeo explicativo do Shopvax/)
   await summary.click()
   const player=page.locator('.svx-support__video video')
   await player.waitFor()
   assert.equal(await player.getAttribute('autoplay'),null)
   assert.equal(await player.getAttribute('preload'),'none')
   assert.match(await page.locator('.svx-support__video').innerText(),/não comprova envio nem pagamento/)
   const response=await page.request.get('http://127.0.0.1:5173/help/shopvax-guide.mp4')
   assert.equal(response.status(),200,'Vídeo precisa estar acessível na build')
   assert.match(response.headers()['content-type']||'',/video\/mp4/)
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
   assert(overflow<=2,'Video modal must fit '+width)
   await page.close()
 }
} finally { await browser.close() }
console.log('SHOPVAX_B02_SELF_HOSTED_VIDEO_OK')
