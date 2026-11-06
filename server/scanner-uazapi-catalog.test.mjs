import test from 'node:test'
import assert from 'node:assert/strict'
import {
  whatsappCatalogPhone,normalizeWhatsAppCatalogPayload,
  uazapiCatalogConfig,collectWhatsAppCatalog,
} from './scanner-uazapi-catalog.mjs'

const link='https://wa.me/c/5511961860913'
const env={
  SHOPVAX_WHATSAPP_UAZAPI_URL:'https://uazapi.example.com/',
  SHOPVAX_WHATSAPP_UAZAPI_TOKEN:'instance-test-token',
}

test('recognizes only exact HTTPS WhatsApp catalog links',()=>{
  assert.equal(whatsappCatalogPhone(link),'5511961860913')
  for(const bad of [
    'https://wa.me/5511961860913',
    'http://wa.me/c/5511961860913',
    'https://wa.me.evil.invalid/c/5511961860913',
    'https://wa.me/c/5511961860913?redirect=evil',
    'https://user:pass@wa.me/c/5511961860913',
  ]) assert.equal(whatsappCatalogPhone(bad),null,bad)
})

test('maps UAZAPI BusinessProduct fields and divides integer thousandths by 1000',()=>{
  const products=normalizeWhatsAppCatalogPayload({response:{products:[
    {id:'1001',name:'Vestido longo',price:'29990',currency:'BRL',retailer_id:'VL-01',
      media:{images:[{id:'img-1',original_image_url:'https://lookaside.whatsapp.net/item.jpg',request_image_url:'https://mmg.whatsapp.net/item.jpg'}]}},
    {id:'1002',name:'Blusa azul',price:'49990',description:'Algodão',media:{images:[]}},
    {id:'1003',name:'Blusa sem preço',price:'',media:{images:[]}},
    {id:'1004',name:'Conjunto em promoção',price:'59990',sale_price:{price:'39990'},media:{images:[]}},
    {id:'1001',name:'Duplicado',price:'29990',media:{images:[]}},
  ]}},'5511961860913',link)
  assert.equal(products.length,4)
  assert.equal(products[0].price,29.99)
  assert.equal(products[0].sku,'VL-01')
  assert.deepEqual(products[0].images,['https://lookaside.whatsapp.net/item.jpg'])
  assert.equal(products[1].price,49.99)
  assert.equal(products[2].price,null)
  assert.equal(products[3].price,39.99)
  assert.ok(products.every(p=>p.source==='whatsapp-uazapi'))
  assert.equal(new Set(products.map(p=>p.source_url)).size,products.length)
})

test('calls UAZAPI POST /business/catalog/list with token, jid and opaque after cursor',async()=>{
  const calls=[]
  const batches=[]
  const responses=[
    {response:{products:[{id:'11',name:'Primeiro',price:'19990',media:{images:[]}}],next:'opaque-cursor-01'}},
    {response:{products:[{id:'22',name:'Segundo',price:'29990',media:{images:[]}}]}},
  ]
  const result=await collectWhatsAppCatalog(link,{
    env,collectInMemory:false,onBatch:async batch=>batches.push(...batch),
    onProgress:async()=>{},request:async(url,opts)=>{
      calls.push({url,opts})
      return {ok:true,status:200,body:JSON.stringify(responses[calls.length-1])}
    },
  })
  assert.equal(result.platform,'whatsapp')
  assert.equal(result.pagesScanned,2)
  assert.equal(result.candidateCount,2)
  assert.deepEqual(result.candidates,[])
  assert.equal(batches.length,2)
  assert.equal(calls[0].url,'https://uazapi.example.com/business/catalog/list')
  assert.equal(calls[0].opts.method,'POST')
  assert.equal(calls[0].opts.headers.token,'instance-test-token')
  assert.equal(calls[0].opts.followRedirects,false)
  assert.deepEqual(JSON.parse(calls[0].opts.body),{jid:'5511961860913@s.whatsapp.net'})
  assert.deepEqual(JSON.parse(calls[1].opts.body),{jid:'5511961860913@s.whatsapp.net',after:'opaque-cursor-01'})
})

test('fails closed on missing token, unauthorized access and unexpected schema',async()=>{
  assert.throws(()=>uazapiCatalogConfig({}),/SHOPVAX_WHATSAPP_UAZAPI_TOKEN/)
  await assert.rejects(
    ()=>collectWhatsAppCatalog(link,{env,request:async()=>({ok:false,status:401})}),
    /recusou o token/,
  )
  await assert.rejects(
    ()=>collectWhatsAppCatalog(link,{env,request:async()=>({ok:true,status:200,body:JSON.stringify({products:[]})})}),
    /sem response.products/,
  )
})

test('rejects pagination loops and avoids publishing a partial catalog',async()=>{
  let batches=0
  await assert.rejects(()=>collectWhatsAppCatalog(link,{
    env,onBatch:async()=>{batches++},onProgress:async()=>{},
    request:async()=>({ok:true,status:200,body:JSON.stringify({
      response:{products:[{id:'x',name:'A',price:'19990'}],next:'repeat'},
    })}),
  }),/Paginação repetida/)
  assert.equal(batches,0)
})
