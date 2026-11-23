import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const cpf='52998224725'
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const browser=await chromium.launch({headless:true})
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}})
  let signedIn=false, registrations=0
  let buyer={id:'buyer-e2e',phone:'5571999999999',name:'Maria da Silva',document:cpf,profileCompleted:true}
  await page.route('**/api/public/buyer-auth/me',r=>r.fulfill(
    signedIn?json({buyer}):json({error:'Entre com telefone e senha.'},401)))
  await page.route('**/api/public/buyer-auth/register-password',r=>{
    const body=r.request().postDataJSON()
    assert.deepEqual(Object.keys(body).sort(),['document','name','password','phone'],'Cadastro não deve exigir código, e-mail ou marketing')
    assert.equal(body.document,cpf)
    assert.equal(body.name,'Maria da Silva')
    assert.equal(body.phone,'(71) 99999-9999')
    assert.equal(body.password,'Senha-super-segura-2026!')
    registrations++
    signedIn=true
    return r.fulfill(json({ok:true,created:true,buyer},201))
  })
  await page.route('**/api/public/buyer-auth/attribute-origin',r=>r.fulfill(json({ok:true})))
  await page.route('**/api/social/buyer/orders',r=>r.fulfill(json({orders:[]})))
  await page.goto('http://127.0.0.1:5173/comprador',{waitUntil:'domcontentloaded'})
  await page.getByRole('heading',{name:'Entrar na minha conta'}).waitFor({timeout:20000})
  await page.getByRole('button',{name:'Criar conta',exact:true}).click()
  await page.getByRole('heading',{name:'Criar conta'}).waitFor()
  const form=page.locator('.buyer-whatsapp-auth form')
  assert.equal(await form.locator('input').count(),4,'Quatro campos: nome, CPF/CNPJ, telefone e senha')
  assert.equal(await form.locator('select,input[type=email],input[type=checkbox]').count(),0)
  await page.getByLabel('Nome completo').fill('Maria da Silva')
  await page.getByLabel('CPF ou CNPJ').fill('529.982.247-25')
  await page.getByLabel('Telefone com DDD').fill('(71) 99999-9999')
  await page.getByLabel('Senha').fill('Senha-super-segura-2026!')
  await page.getByRole('button',{name:'Criar minha conta'}).click()
  await page.getByRole('heading',{name:'Maria da Silva'}).first().waitFor({timeout:20000})
  assert.equal(registrations,1,'Cadastro não deve repetir requests')
  assert.equal(await page.getByText('Modalidade de compra').count(),0)
  const geometry=await page.evaluate(()=>({viewport:innerWidth,docWidth:document.documentElement.scrollWidth}))
  assert(geometry.docWidth<=width+2,'Cadastro causou overflow: '+JSON.stringify(geometry))
  console.log('BUYER_NO_OTP_PASSWORD_REGISTRATION_PASS',width,geometry)
  await page.close()
 }
} finally {await browser.close()}
