import {chromium} from 'playwright'
import assert from 'node:assert/strict'

const plans=[
{code:'bronze',name:'Bronze',monthlyPrice:49.90,sellerLimit:2,catalogLimit:1,photoLimit:5,franchiseeLimit:0,productLimit:null},
{code:'prata',name:'Prata',monthlyPrice:94.90,sellerLimit:4,catalogLimit:3,photoLimit:10,franchiseeLimit:2,productLimit:null},
{code:'ouro',name:'Ouro',monthlyPrice:144.90,sellerLimit:null,catalogLimit:null,photoLimit:null,franchiseeLimit:null,productLimit:null},
]
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height] of [[320,568],[390,844],[1440,900]]){
  const page=await browser.newPage({viewport:{width,height}})
  await page.route('**/api/public/plans',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans})}))
  await page.goto('http://127.0.0.1:5173/')
  const table=page.getByRole('region',{name:'Comparação dos planos Shopvax'})
  await table.waitFor()
  assert.equal(await table.locator('table thead th').count(),4)
  assert.equal(await table.locator('tbody tr').count(),5)
  assert.match(await table.innerText(),/Ilimitados/)
  assert.match(await table.innerText(),/94,90/)
  const pricingBounds=await table.boundingBox()
  assert(pricingBounds?.width && pricingBounds.width>0)
  await table.getByRole('button',{name:/Começar no Prata/}).click()
  await page.waitForURL(/criar-conta\?plan=prata/)
  console.log('PLANS_PASS',width,height)
  await page.close()
 }
}finally{await browser.close()}
console.log('PLANS_UI_TESTS_PASSED',3)
