import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({headless:true})
const json=(data,status=200)=>({status,contentType:'application/json',body:JSON.stringify(data)})
const publicStore={
  store:{slug:'galego-bijux',name:'Galego Bijux',eyebrow:'Atacado',tagline:'Produtos',minimumOrder:500,whatsapp:'5571999999999',logoUrl:'',accent:'#F25C05'},
  seller:{slug:'',name:'Atendimento',phone:'5571999999999'},products:[],catalogs:[],categories:[],
}
try {
  const cases=[
    {name:'owner of this store',owner:'galego-bijux',enabled:true,customer:false,want:'Painel da loja'},
    {name:'owner with customer module disabled',owner:'galego-bijux',enabled:false,customer:false,want:'Painel da loja'},
    {name:'owner of another store',owner:'outra-loja',enabled:true,customer:false,want:'Entrar'},
    {name:'customer logged in',owner:null,enabled:true,customer:true,want:'Minha conta'},
    {name:'anonymous',owner:null,enabled:true,customer:false,want:'Entrar'},
    {name:'owner session temporarily unavailable',owner:'unavailable',enabled:true,customer:false,want:'Verificar acesso'},
  ]
  for(const c of cases){
    const context=await browser.newContext({viewport:{width:1280,height:840}})
    try {
      await context.route('**/api/auth/me',r=>r.fulfill(
        c.owner==='unavailable'?json({error:'Temporary failure'},503)
        :c.owner?json({user:{id:'owner',name:'Lojista'},store:{id:'store-id',slug:c.owner,name:'Loja'}})
        :json({error:'Sessão necessária'},401)
      ))
      await context.route('**/api/public/store/galego-bijux/phase2-config',r=>r.fulfill(json({
        customerLoginEnabled:c.enabled,theme:{background:'#fff',textColor:'#161514',font:'system'}
      })))
      await context.route('**/api/public/store/galego-bijux/customers/me',r=>r.fulfill(
        c.customer?json({customer:{id:'buyer'}}):json({error:'Autenticação necessária'},401)
      ))
      await context.route(url=>url.pathname==='/api/public/store/galego-bijux',r=>r.fulfill(json(publicStore)))
      await context.route('**/api/public/events',r=>r.fulfill({status:204,body:''}))
      const page=await context.newPage()
      await page.goto('http://127.0.0.1:5173/galego-bijux',{waitUntil:'domcontentloaded'})
      const button=page.locator('.shopvax-customer-launcher')
      await button.getByText(c.want,{exact:true}).waitFor({timeout:20000})
      assert.equal((await button.innerText()).trim(),c.want,c.name)
      if(c.owner==='galego-bijux'){
        assert.equal(await button.getByText('Entrar',{exact:true}).count(),0,'Lojista autenticado não deve ver Entrar')
        await button.click()
        await page.waitForURL(/\/painel$/, {timeout:15000})
      }
      console.log('SHOPVAX_OWNER_STORE_LAUNCHER_PASS',c.name)
    }finally {await context.close()}
  }
}finally {await browser.close()}
