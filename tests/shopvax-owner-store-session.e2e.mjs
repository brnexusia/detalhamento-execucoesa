import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({headless:true})
const payload={
  store:{slug:'galego-bijux',name:'Galego Bijux',eyebrow:'Atacado',tagline:'',minimumOrder:0,whatsapp:'',accent:'#F25C05'},
  seller:{slug:'',name:'',phone:''},products:[],categories:[],catalogs:[],page:{hasMore:false,nextCursor:null,limit:18}
}
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const scenarios=[
  {name:'own-store',ownerSlug:'galego-bijux',customer:false,expected:'Meu painel'},
  {name:'foreign-owner',ownerSlug:'outra-loja',customer:false,expected:'Entrar'},
  {name:'store-customer',ownerSlug:'',customer:true,expected:'Minha conta'},
  {name:'visitor',ownerSlug:'',customer:false,expected:'Entrar'},
]
try{
  for(const scenario of scenarios){
    const context=await browser.newContext({viewport:{width:390,height:844}})
    await context.route('**/api/public/store/galego-bijux**',route=>{
      const path=new URL(route.request().url()).pathname
      if(path.endsWith('/phase2-config'))return route.fulfill(json({customerLoginEnabled:true,theme:{background:'#fff',textColor:'#161514',font:'system'}}))
      if(path.endsWith('/customers/me'))return route.fulfill(json(scenario.customer?{customer:{id:'user-1'}}:{error:'Sessão necessária.'},scenario.customer?200:401))
      return route.fulfill(json(payload))
    })
    await context.route('**/api/auth/me',route=>route.fulfill(scenario.ownerSlug
      ?json({user:{id:'owner',name:'Teste',email:'owner@example.test'},store:{id:'store',slug:scenario.ownerSlug,name:'Loja'}})
      :json({error:'Sessão necessária.'},401)))
    await context.route('**/api/public/events',route=>route.fulfill(json({ok:true})))
    const page=await context.newPage()
    try{
      await page.goto('http://127.0.0.1:5173/galego-bijux',{waitUntil:'domcontentloaded'})
      // O cabeçalho móvel esconde as ações até abrir o menu.
      await page.getByRole('button',{name:'Menu',exact:true}).click()
      await page.getByRole('button',{name:scenario.expected,exact:true}).waitFor({timeout:18000})
      assert.equal(await page.getByRole('button',{name:'Entrar',exact:true}).count(),scenario.expected==='Entrar'?1:0,
        scenario.name+': não deve mostrar Entrar para sessão reconhecida')
      if(scenario.expected==='Meu painel'){
        await page.getByRole('button',{name:'Meu painel'}).click()
        await page.waitForURL('**/painel')
      }
      console.log('SHOPVAX_OWNER_STORE_SESSION_OK',scenario.name)
    }finally{await context.close()}
  }
}finally{await browser.close()}
