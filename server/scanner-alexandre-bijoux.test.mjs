import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCatalog } from './scanner-collector.mjs'
import { alexandreProduct, isAlexandreBijouxStorefront } from './scanner-alexandre-bijoux.mjs'

const origin='https://bijouxalexandre.com.br'
const categoryA={id:'brincos',nome:'BRINCO',totalPecas:2}
const categoryB={id:'aneis',nome:'ANEL',totalPecas:1}
const photo='https://example.supabase.co/storage/v1/object/public/fotos/brinco.webp'
const item=(id,name,price)=>({id,nome:name,precoPor:price,imagemUrl:photo})
function setup(routes) {
  return async(input)=>{
    const path=new URL(input).pathname
    const body=routes[path]
    return body==null
      ? {ok:false,status:404,url:input,contentType:'text/plain',body:''}
      : {ok:true,status:200,url:input,contentType:path==='/'?'text/html':'application/json',body:typeof body==='string'?body:JSON.stringify(body)}
  }
}
test('Alexandre domain matching remains exact',()=>{
  assert.equal(isAlexandreBijouxStorefront(origin+'/'),true)
  assert.equal(isAlexandreBijouxStorefront('https://fake-bijouxalexandre.com.br/'),false)
  assert.equal(isAlexandreBijouxStorefront('https://bijouxalexandre.com.br.evil.test/'),false)
})
test('Alexandre imports all public categories, prices and original photo urls',async()=>{
  const request=setup({
    '/':'<html><script src="/assets/app.js"></script></html>',
    '/api/categorias':[categoryA,categoryB],
    '/api/categorias/brincos/produtos':{tags:[],produtos:[item('p1','BRINCO',24),item('p2','ARGOLA',39)]},
    '/api/categorias/aneis/produtos':{tags:[],produtos:[item('p3','ANEL',100)]},
  })
  const got=await collectCatalog(origin+'/',{request,strictPlatformAdapters:true})
  assert.equal(got.platform,'alexandre-bijoux')
  assert.equal(got.complete,true)
  assert.equal(got.candidateCount,3)
  assert.deepEqual(got.candidates.map(x=>x.category),['BRINCO','BRINCO','ANEL'])
  assert.deepEqual(got.candidates.map(x=>x.price),[24,39,100])
  assert.equal(got.candidates[0].images[0],photo)
})
test('Alexandre refuses to claim full catalog when a category is truncated',async()=>{
  const request=setup({
    '/':'<html></html>',
    '/api/categorias':[categoryA],
    '/api/categorias/brincos/produtos':{produtos:[item('p1','BRINCO',24)]},
  })
  await assert.rejects(collectCatalog(origin+'/',{request}),/retornou 1 de 2/)
})
test('Alexandre reports partial result under an explicit product cap',async()=>{
  const request=setup({
    '/':'<html></html>',
    '/api/categorias':[categoryA,categoryB],
    '/api/categorias/brincos/produtos':{produtos:[item('p1','BRINCO',24),item('p2','ARGOLA',39)]},
  })
  const got=await collectCatalog(origin+'/',{request,maxProducts:1})
  assert.equal(got.candidateCount,1)
  assert.equal(got.complete,false)
})
test('Alexandre maps absent price without fabricating a number',()=>{
  const mapped=alexandreProduct({id:'a',nome:'Peça',precoPor:null,imagemUrl:photo},categoryA,origin)
  assert.equal(mapped.price,null)
  assert.equal(mapped.images[0],photo)
})
