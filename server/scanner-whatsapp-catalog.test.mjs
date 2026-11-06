import test from 'node:test'
import assert from 'node:assert/strict'
import {
  whatsappCatalogPhone, normalizeWhatsAppCatalogPayload,
  evolutionCatalogConfig, collectWhatsAppCatalog,
} from './scanner-whatsapp-catalog.mjs'

const link='https://wa.me/c/5511961860913'
const env={
 SHOPVAX_WHATSAPP_EVOLUTION_URL:'https://evolution.example.com/',
 SHOPVAX_WHATSAPP_EVOLUTION_INSTANCE:'loja1',
 SHOPVAX_WHATSAPP_EVOLUTION_API_KEY:'test-key',
}

test('recognizes only exact HTTPS WhatsApp catalog links',()=>{
 assert.equal(whatsappCatalogPhone(link),'5511961860913')
 for (const bad of [
  'https://wa.me/5511961860913','https://wa.me/c/abc',
  'https://wa.me.evil.test/c/5511961860913',
  'http://wa.me/c/5511961860913',
  'https://wa.me/c/5511961860913?redirect=evil',
  'https://admin:pw@wa.me/c/5511961860913',
 ]) assert.equal(whatsappCatalogPhone(bad),null,bad)
})

test('normalizes WhatsApp money from thousandths, preserves missing prices and unique source keys',()=>{
 const candidates=normalizeWhatsAppCatalogPayload({catalog:[
  {id:'123456',name:'Vestido longo',priceAmount1000:'29990',currencyCode:'BRL',retailerId:'VL-01',images:[{url:'https://images.example.com/a.jpg'}]},
  {id:'bbb',name:'Blusa azul',description:'Algodão',priceAmount1000:49990},
  {name:'Blusa branca',price:null,imageUrl:'https://images.example.com/c.jpg'},
  {name:'Blusa rosa',price:'19,90'},
  {id:'123456',name:'Duplicada'},
 ]},'5511961860913',link)
 assert.equal(candidates.length,4)
 assert.equal(candidates[0].price,29.99)
 assert.equal(candidates[0].sku,'VL-01')
 assert.equal(candidates[0].images[0],'https://images.example.com/a.jpg')
 assert.equal(candidates[1].price,49.99)
 assert.equal(candidates[2].price,null)
 assert.equal(candidates[3].price,19.90)
 assert.equal(new Set(candidates.map(x=>x.source_url)).size,4)
 assert.ok(candidates.every(x=>x.source==='whatsapp-evolution'))
})

test('collector uses authenticated configured Evolution instance and returns actual candidates',async()=>{
 const call=[]
 const batches=[]
 const response={catalog:[{id:'222',name:'Conjunto',priceAmount1000:'45500',images:['https://cdn.example.com/photo.jpg']}]}
 const result=await collectWhatsAppCatalog(link,{
  env,request:async (url,opts)=>{
   call.push({url,opts})
   return {status:200,ok:true,body:JSON.stringify(response)}
  },
  onBatch:async batch=>batches.push(...batch),
  onProgress:async()=>{},collectInMemory:false,
 })
 assert.equal(result.platform,'whatsapp')
 assert.equal(result.candidateCount,1)
 assert.equal(result.candidates.length,0)
 assert.equal(batches[0].price,45.50)
 assert.equal(call[0].url,'https://evolution.example.com/business/getCatalog/loja1')
 assert.equal(JSON.parse(call[0].opts.body).number,'5511961860913')
 assert.equal(call[0].opts.headers.apikey,'test-key')
 assert.equal(call[0].opts.followRedirects,false)
})
test('missing credentials and inaccessible catalogs fail closed with explicit error',async()=>{
 assert.throws(()=>evolutionCatalogConfig({}),/configure SHOPVAX_WHATSAPP_EVOLUTION/)
 await assert.rejects(()=>collectWhatsAppCatalog(link,{env,request:async()=>({status:401,ok:false})}),/não autorizou/)
 await assert.rejects(()=>collectWhatsAppCatalog(link,{env,request:async()=>({status:200,ok:true,body:JSON.stringify({isBusiness:false})})}),/não retornou produtos/)
})
