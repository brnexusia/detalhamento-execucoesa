import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Regressão da sincronização do carrinho (issue #85): evento na mesma aba,
// storage em outra aba e ausência de polling constante em repouso.
const browser = await chromium.launch({ headless: true })
const data = {
  store: { slug:'loja-teste', name:'Loja Teste', minimumOrder:100, whatsapp:'5571999999999', accent:'#F25C05' },
  seller: { slug:'ana', name:'Ana', phone:'5571999999999' },
  products: [{ id:'p1', sku:'REF-1', name:'Vestido de teste', description:'', price:59.9,
    category:'Moda',mediaUrl:'',mediaType:'image',images:[],variations:[],stockQuantity:100 }],
  categories:['Moda'], page:{hasMore:false,nextCursor:null,limit:24},
}
const key = 'shopvax-cart-v1:loja-teste'
const cart = (quantity) => [{
  product:{ id:'p1', name:'Vestido de teste', price:59.9 },
  quantity, selections:{}, key:'p1-test',
}]
try {
  const context = await browser.newContext({ viewport:{width:390,height:844} })
  await context.route('**/api/public/store/loja-teste**',route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(data),
  }))
  await context.route('**/api/public/reviews/**',route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({enabled:false,average:0,count:0,reviews:[]}),
  }))
  const first = await context.newPage()
  let firstRequests = []
  await first.route('**/api/public/cart-recovery',route => {
    firstRequests.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  await first.goto('http://127.0.0.1:5173/loja-teste')
  await first.locator('.product-card').first().waitFor()
  await first.waitForTimeout(1100)
  firstRequests = []

  await first.evaluate(({key,items}) => {
    localStorage.setItem(key, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('shopvax:cart-change',{detail:{storeSlug:'loja-teste'}}))
  }, {key,items:cart(2)})
  await first.waitForTimeout(1100)
  assert(firstRequests.some(x => x.items?.[0]?.quantity === 2 && x.subtotal === 119.8),
    'Evento shopvax:cart-change deve atualizar o snapshot com quantidade e subtotal')
  firstRequests = []

  // Alterar o armazenamento não dispara "storage" na própria aba;
  // evento atribuído a outra loja também não deve iniciar recuperação desta.
  await first.evaluate(({key,items}) => {
    localStorage.setItem(key, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('shopvax:cart-change',{detail:{storeSlug:'outra-loja'}}))
  }, {key,items:cart(3)})
  await first.waitForTimeout(1600)
  assert.equal(firstRequests.length,0,'Sem evento da loja, não há polling nem reenvio ocioso')

  // Ao abrir outra aba, o evento storage precisa manter o carrinho da loja sincronizado.
  const second = await context.newPage()
  let secondRequests = []
  await second.route('**/api/public/cart-recovery',route => {
    secondRequests.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  await second.goto('http://127.0.0.1:5173/loja-teste')
  await second.locator('.product-card').first().waitFor()
  await second.waitForTimeout(1100)
  secondRequests = []
  await first.evaluate(({key,items}) => {
    localStorage.setItem(key,JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('shopvax:cart-change',{detail:{storeSlug:'loja-teste'}}))
  }, {key,items:cart(4)})
  await second.waitForTimeout(1100)
  assert(secondRequests.some(x => x.items?.[0]?.quantity === 4 && x.subtotal === 239.6),
    'Evento storage deve restaurar snapshot atualizado entre abas')
  await context.close()
} finally {
  await browser.close()
}
console.log('SHOPVAX_CART_EVENTS_OK')
