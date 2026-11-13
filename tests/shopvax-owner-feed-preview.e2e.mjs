import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)})
const post={id:'post-1',product:{id:'p-1',name:'Brinco Aço Inox',description:'Coleção',sku:'FZ123',category:'Brincos',mediaUrl:'',mediaType:'image',images:[],variations:[],publishedAt:'2026-11-13T00:00:00Z'},
  store:{id:'store-1',slug:'galego-bijux',name:'Galego Bijux',logoUrl:'',accent:'#F25C05',planTier:'ouro'},
  interactions:{views:0,likes:0,shares:0,followers:0,liked:false,following:false}}
const offer={id:'c-1',slug:'geral',name:'Atacado',kind:'atacado',price:89.9,minimumOrder:0,unitsPerBox:1}
const browser=await chromium.launch({headless:true})
try {
  for(const sc of [
    {name:'owner-own-store',buyer:false,owner:'galego-bijux',preview:true},
    {name:'owner-other-store',buyer:false,owner:'outra-loja',preview:false},
    {name:'buyer-verified',buyer:true,owner:null,preview:false},
    {name:'visitor',buyer:false,owner:null,preview:false},
  ]){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    try{
      await context.route('**/api/social/feed?**',r=>r.fulfill(json({posts:[post],page:{hasMore:false,nextCursor:null}})))
      await context.route('**/api/public/buyer-auth/me',r=>r.fulfill(
        sc.buyer?json({buyer:{id:'buyer',name:'Comprador',phone:'5571999999999',city:'Salvador',profileCompleted:true}}):json({error:'Entrar'},401)))
      await context.route('**/api/auth/me',r=>r.fulfill(
        sc.owner?json({user:{id:'owner'},store:{id:'store-1',slug:sc.owner}}):json({error:'Entrar'},401)))
      await context.route('**/api/social/stores/galego-bijux/seller-route',r=>r.fulfill(json({seller:{name:'Atendimento',slug:''}})))
      await context.route('**/api/social/stores/galego-bijux/products/p-1/offers',r=>r.fulfill(
        (sc.buyer||sc.preview)?json({product:post.product,offers:[offer],buyerPurpose:'revenda',ownerPreview:sc.preview})
        :json({code:'BUYER_PROFILE_REQUIRED',error:'Comprador necessário'},401)))
      await context.route('**/api/social/posts/**',r=>r.fulfill(json({views:1})))
      const page=await context.newPage()
      let offerCalls=0
      page.on('request',request=>{if(request.url().includes('/products/p-1/offers'))offerCalls++})
      await page.goto('http://127.0.0.1:5173/feed',{waitUntil:'domcontentloaded'})
      await page.locator('.social-feed-card').first().waitFor({timeout:20000})
      await page.getByRole('button',{name:/Ver preço \/ Comprar/}).first().click()
      const modal=page.locator('.svx-social-shop')
      await modal.waitFor()
      if(sc.preview){
        await modal.getByText('Visualização do lojista.',{exact:false}).waitFor()
        await modal.getByText('R$ 89,90').first().waitFor()
        assert.equal(await modal.getByRole('button',{name:/Adicionar ·/}).count(),0)
        assert.equal(await modal.getByText('Receber código no WhatsApp').count(),0)
        assert.equal(offerCalls,1)
      }else if(sc.buyer){
        await modal.getByRole('button',{name:/Adicionar ·/}).waitFor()
        await modal.getByText('R$ 89,90').first().waitFor()
        assert.equal(offerCalls,1)
      }else{
        await modal.getByRole('button',{name:'Receber código no WhatsApp'}).waitFor()
        assert.equal(offerCalls,0,'Não buscar preços com sessão não autorizada')
      }
      console.log('SHOPVAX_OWNER_FEED_PREVIEW_PASS',sc.name)
    }finally{await context.close()}
  }
}finally{await browser.close()}
