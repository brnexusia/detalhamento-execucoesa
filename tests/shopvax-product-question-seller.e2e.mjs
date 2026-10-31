import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Regressão P0 da issue #109: telefone principal da loja nunca atende perguntas
// de produto nem recebe pedidos por fallback; exige vendedora atribuída.
const browser = await chromium.launch({headless:true})
const product = {
  id:'p1',sku:'REF-101',name:'Vestido Aurora',description:'',price:59.9,
  category:'Moda',mediaUrl:'',mediaType:'image',images:[],variations:[],stockQuantity:100,
}
const base = {
  store:{slug:'loja-teste',name:'Loja Teste',minimumOrder:100,
    whatsapp:'5571888888888',accent:'#F25C05'},
  products:[product],categories:['Moda'],
  page:{hasMore:false,nextCursor:null,limit:24},
}

async function verify(seller, expectedPhone) {
  const context=await browser.newContext({viewport:{width:390,height:844}})
  const page=await context.newPage()
  await page.addInitScript(() => {
    window.__openedWhatsApp = []
    window.open = (url) => { window.__openedWhatsApp.push(String(url)); return null }
  })
  await page.route('**/api/public/store/loja-teste**',route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({...base,seller}),
  }))
  await page.goto('http://127.0.0.1:5173/loja-teste')
  await page.locator('.product-card').first().waitFor()
  await page.getByRole('button',{name:/Passar uma por uma/}).click()
  await page.getByRole('button',{name:'Perguntar sobre Vestido Aurora'}).click()
  const opened = await page.evaluate(() => window.__openedWhatsApp)
  if (!expectedPhone) {
    assert.equal(opened.length,0,'WhatsApp principal nunca deve ser fallback')
    await page.getByRole('status').getByText(/Não há vendedora disponível/).waitFor()
  } else {
    assert.equal(opened.length,1,'Deve abrir o WhatsApp uma vez')
    assert.match(opened[0],new RegExp('^https://wa\\.me/'+expectedPhone+'\\?'))
    assert(!opened[0].includes('5571888888888'),'Número administrativo não pode vazar para o atendimento')
    const body = new URL(opened[0]).searchParams.get('text') || ''
    assert.match(body,/Vestido Aurora/)
    assert.match(body,/REF-101/)
  }
  await context.close()
}
try {
  await verify(null,null)
  await verify({slug:'ana',name:'Ana',phone:'5571999999999'},'5571999999999')
} finally {
  await browser.close()
}
console.log('SHOPVAX_PRODUCT_QUESTION_SELLER_ONLY_OK')
