import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const cpf='52998224725'
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const browser=await chromium.launch({headless:true})
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}})
  let verified=false,complete=false,profileWrites=0
  let buyer={id:'buyer-e2e',phone:'5571999999999',name:'',document:'',profileCompleted:false}
  await page.route('**/api/public/buyer-auth/me',r=>r.fulfill(
    verified?json({buyer}):json({error:'Entre com seu WhatsApp.'},401)))
  await page.route('**/api/public/buyer-auth/request-code',r=>{
    const body=r.request().postDataJSON()
    assert.equal(body.phone,'(71) 99999-9999')
    assert.deepEqual(Object.keys(body),['phone'],'OTP não deve pedir dados extras')
    return r.fulfill(json({ok:true,expiresInSeconds:300,resendAfterSeconds:60}))
  })
  await page.route('**/api/public/buyer-auth/verify-code',r=>{
    assert.deepEqual(r.request().postDataJSON(),{phone:'(71) 99999-9999',code:'123456'})
    verified=true
    return r.fulfill(json({ok:true,created:true,needsProfile:true,buyer}))
  })
  await page.route('**/api/public/buyer-auth/profile',r=>{
    const body=r.request().postDataJSON()
    assert.deepEqual(Object.keys(body).sort(),['document','name'],'Cadastro não deve enviar e-mail, finalidade ou marketing')
    assert.equal(body.document,cpf)
    assert.equal(body.name,'Maria da Silva')
    complete=true;profileWrites++
    buyer={...buyer,name:body.name,document:body.document,profileCompleted:true}
    return r.fulfill(json({ok:true,buyer}))
  })
  await page.route('**/api/social/buyer/orders',r=>r.fulfill(json({orders:[]})))
  await page.goto('http://127.0.0.1:5173/comprador',{waitUntil:'domcontentloaded'})
  await page.getByRole('heading',{name:'Entrar com WhatsApp'}).waitFor({timeout:20000})
  await page.getByLabel('Telefone com DDD').fill('(71) 99999-9999')
  await page.getByRole('button',{name:'Receber código no WhatsApp'}).click()
  await page.getByLabel('Código de verificação').fill('123456')
  await page.getByRole('button',{name:'Confirmar código'}).click()
  await page.getByRole('heading',{name:'Cadastro de comprador'}).waitFor()
  const form=page.locator('.buyer-whatsapp-auth form')
  assert.equal(await form.locator('input').count(),3,'Só três campos visíveis: nome, CPF/CNPJ e telefone')
  assert.equal(await form.locator('select, input[type=email], input[type=checkbox]').count(),0)
  assert.equal(await page.getByLabel('Telefone verificado').inputValue(),'5571999999999')
  assert.equal(await page.getByLabel('Telefone verificado').getAttribute('readonly'),'')
  await page.getByLabel('Nome completo').fill('Maria da Silva')
  await page.getByLabel('CPF ou CNPJ').fill('529.982.247-25')
  await page.getByRole('button',{name:'Concluir cadastro'}).click()
  await page.getByRole('heading',{name:'Maria da Silva'}).first().waitFor({timeout:20000})
  assert.equal(complete,true,'Perfil não foi salvo')
  assert.equal(profileWrites,1,'Não deve salvar cadastro duas vezes')
  assert.equal(await page.getByText('Modalidade de compra').count(),0)
  const geometry=await page.evaluate(()=>({
    viewport:innerWidth,docWidth:document.documentElement.scrollWidth
  }))
  assert(geometry.docWidth<=width+2,'Cadastro provocou overflow: '+JSON.stringify(geometry))
  console.log('BUYER_THREE_FIELDS_PASS',width,geometry)
  await page.close()
 }
} finally {await browser.close()}
