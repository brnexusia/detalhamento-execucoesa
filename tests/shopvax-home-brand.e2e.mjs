import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

// Verificação visual da página institucional oficial; backend de planos simulado.
// As capturas ajudam revisão humana, não garantem igualdade pixel a pixel com o ZIP.
const favicon = readFileSync('public/favicon.svg', 'utf8')
assert.match(favicon, /#F25C05/i)
assert.match(favicon, /#161514/i)
assert.doesNotMatch(favicon, /#c8ff38/i)
const main = readFileSync('src/main.tsx', 'utf8')
assert.match(main, /import '.\/shopvax-home\.css'/)

const plans = [
  {code:'bronze',name:'Bronze',monthlyPrice:49.9,sellerLimit:1,catalogLimit:1,photoLimit:3,franchiseeLimit:0,productLimit:100},
  {code:'prata',name:'Prata',monthlyPrice:99.9,sellerLimit:3,catalogLimit:3,photoLimit:10,franchiseeLimit:0,productLimit:500},
  {code:'ouro',name:'Ouro',monthlyPrice:149.9,sellerLimit:null,catalogLimit:null,photoLimit:null,franchiseeLimit:null,productLimit:null},
]
const browser = await chromium.launch({headless:true})
mkdirSync('artifacts/shopvax-redesign', {recursive:true})
try {
  for (const [width,height] of [[390,844], [1440,900]]) {
    const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1})
    await page.route('**/api/public/plans', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans})}))
    await page.goto('http://127.0.0.1:5173/para-lojas')
    await page.getByRole('heading', {name:/O TALÃO DE PEDIDO, NO CELULAR/i}).waitFor()
    await page.getByRole('heading', {name:/Escolha o tamanho da sua empresa ou loja/i}).waitFor()
    assert.equal(await page.locator('.svx-home-ticket__steps > div').count(),3)
    const styles = await page.evaluate(() => {
      const body = getComputedStyle(document.querySelector('.home-shell'))
      const title = getComputedStyle(document.querySelector('.svx-home-hero__message h1'))
      const cta = getComputedStyle(document.querySelector('.home-hero__actions button'))
      return {background:body.backgroundColor,bodyFont:body.fontFamily,titleFont:title.fontFamily,ctaBackground:cta.backgroundColor,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}
    })
    assert.equal(styles.background,'rgb(243, 240, 232)')
    assert.equal(styles.ctaBackground,'rgb(242, 92, 5)')
    assert.match(styles.bodyFont,/Archivo/i)
    assert.match(styles.titleFont,/Archivo Narrow/i)
    assert(styles.scrollWidth <= styles.viewport+2, 'Rolagem horizontal indevida: ' + JSON.stringify(styles))
    await page.screenshot({path:'artifacts/shopvax-redesign/institucional-' + width + '.png', fullPage:true})
    const create = page.getByRole('button',{name:'Criar loja'})
    await create.click()
    assert.equal(new URL(page.url()).pathname,'/criar-conta')
    console.log('SHOPVAX_HOME_BRAND_OK',width,height)
    await page.close()
  }
} finally { await browser.close() }
