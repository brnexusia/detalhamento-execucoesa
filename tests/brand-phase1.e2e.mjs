import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const product = {
  id: 'item-01', sku: 'REF-1041', name: 'Blusa Básica',
  description: 'Produto de atacado', price: 56.9, category: 'Roupas',
  mediaUrl: '', mediaType: 'image', images: [], variations: [
    { name: 'Cor', options: ['Preta','Mostarda'] },
    { name: 'Tamanho', options: ['P','M','G'] },
  ],
}
const tests = [
  { slug:'loja-laranja', name:'ATACADO LARANJA', accent:'#F25C05', width:320, height:568 },
  { slug:'loja-mostarda', name:'MODA MOSTARDA', accent:'#E9B21C', width:390, height:844 },
  { slug:'loja-grafite', name:'GRAFITE ATACADO', accent:'#8A96A1', width:768, height:1024 },
  { slug:'loja-escura', name:'LOJA COR PERSONALIZADA', accent:'#121314', width:1366, height:768 },
]
const browser = await chromium.launch({ headless:true })
try {
  for (const sample of tests) {
    const page = await browser.newPage({ viewport:{ width:sample.width, height:sample.height } })
    const store = {
      slug:sample.slug,
      name:sample.name,
      eyebrow:'Atacado de moda feminina',
      tagline:'Escolha a grade e finalize com sua vendedora.',
      minimumOrder:100,
      whatsapp:'5571999999999',
      accent:sample.accent,
      logoUrl:'',
    }
    const payload = {
      store,seller:{ slug:'marina', name:'Marina', phone:'5571999999999' },
      products:[product], categories:['Roupas'],
      page:{ hasMore:false, nextCursor:null, limit:24 }
    }
    await page.route('**/api/public/store/**', route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}))
    await page.route('**/api/public/events',route=>route.fulfill({status:204,body:''}))
    await page.goto(`http://127.0.0.1:5173/${sample.slug}`)
    await page.locator('.store-intro h1').waitFor()
    assert.equal((await page.locator('.store-intro h1').innerText()).trim(),sample.name)
    assert.match(await page.locator('.brand__text strong').innerText(),new RegExp(sample.name))
    assert.equal((await page.locator('.brand__text small').innerText()).toLocaleLowerCase('pt-BR'),'catálogo de atacado')
    assert.equal((await page.locator('.store-intro__tagline').innerText()).trim(),store.tagline)
    assert.equal((await page.locator('.seller-note strong').innerText()).trim(),'Marina')
    assert.equal(await page.locator('.svx-ribbon').count(),1)
    assert.match(await page.locator('.store-brand-signature').innerText(),/shopvax/i)
    const actualAccent=await page.locator('.app').evaluate(node=>getComputedStyle(node).getPropertyValue('--accent').trim().toLowerCase())
    assert.equal(actualAccent,sample.accent.toLowerCase())
    const titleFont=await page.locator('.store-intro h1').evaluate(node=>getComputedStyle(node).fontFamily)
    assert.match(titleFont,/Archivo Narrow/i)
    const bodyFont=await page.locator('.app').evaluate(node=>getComputedStyle(node).fontFamily)
    assert.match(bodyFont,/Archivo/i)
    const taglineFont=await page.locator('.store-intro__tagline').evaluate(node=>getComputedStyle(node).fontFamily)
    assert.match(taglineFont,/Archivo/i)
    const foreground=await page.locator('.svx-ribbon').evaluate(node=>getComputedStyle(node).color)
    if(sample.accent==='#121314')assert.equal(foreground,'rgb(243, 240, 232)')
    await page.locator('.product-card__media').click()
    await page.getByRole('button',{name:'Preta',exact:true}).click()
    await page.getByRole('button',{name:'P',exact:true}).click()
    await page.locator('.picker-add').click()
    await page.locator('.cart-trigger').click()
    assert.match(await page.locator('.cart-drawer').innerText(),/Blusa Básica/)
    assert.match(await page.locator('.svx-stamp').innerText(),/NA GRADE/)
    console.log('PASS BRAND',sample.slug,sample.width,sample.height)
    await page.close()
  }
} finally { await browser.close() }
console.log('BRAND_PHASE1_TESTS_PASSED',tests.length)
