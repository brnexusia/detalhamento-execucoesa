import test from 'node:test'
import assert from 'node:assert/strict'
import { collectCatalog } from './scanner-collector.mjs'

const root='https://facilzap.com.br/catalogo-teste/5511999999999'
const route='https://facilzap.com.br/catalogo-teste/carregar_produtos/{PAGE}/{CATEGORY}/123'
const html='<html><script>window.FZCatalogoRuntime.listagem = '+
  JSON.stringify({urlCarregarProdutosTemplate:route,categoria:0})+';</script></html>'

function fixture({ resetOnEnd = 0 } = {}) {
  const attempts = new Map()
  const visitedPages = []
  const request=async(url,options={})=>{
    url=String(url)
    if(url===root)return {status:200,ok:true,url,contentType:'text/html',body:html}
    if(url.includes('/carregar_produtos/')){
      const page=Number(/carregar_produtos\/(\d+)\//.exec(url)?.[1])
      visitedPages.push(page)
      const previous=attempts.get(page)||0
      attempts.set(page,previous+1)
      if(page===4 && previous<resetOnEnd)
        throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'})
      if(page===4)return {status:200,ok:true,url,contentType:'application/json',
        body:JSON.stringify({acao:'sem_mais_produtos'})}
      const products=Array.from({length:912},(_,i)=>({
        id:(page-1)*912+i+1,
        nome:'Brinco '+((page-1)*912+i+1),
        preco:'39,90',
        imagens:['produtos/'+((page-1)*912+i+1)+'.webp'],
      }))
      return {status:200,ok:true,url,contentType:'application/json',body:JSON.stringify({produtos:products})}
    }
    // Detail page missing is non-fatal when listing already has product data.
    return {status:404,ok:false,url,contentType:'text/plain',body:''}
  }
  return {request,attempts,visitedPages}
}

test('2736 FácilZap items survive a transient ECONNRESET on the final pagination request',async()=>{
  const network=fixture({resetOnEnd:2})
  const checkpoints=[]
  const scanned=[]
  const result=await collectCatalog(root,{
    request:network.request, strictPlatformAdapters:true,
    retrySleep:async()=>{}, requestMaxAttempts:5,
    onBatch:async items=>scanned.push(...items),
    onPageCheckpoint:async p=>checkpoints.push(p),
    collectInMemory:false,
  })
  assert.equal(result.platform,'facilzap')
  assert.equal(result.complete,true)
  assert.equal(result.candidateCount,2736)
  assert.equal(scanned.length,2736)
  assert.deepEqual(checkpoints.map(x=>x.nextPage),[2,3,4])
  assert.equal(network.attempts.get(4),3)
  assert.equal(new Set(scanned.map(x=>x.external_id)).size,2736)
})

test('exhausted network reset resumes from saved next page, without repeating 2736 detail requests',async()=>{
  const failed=fixture({resetOnEnd:5})
  const saved=[]
  let nextPage=1
  await assert.rejects(collectCatalog(root,{
    request:failed.request,strictPlatformAdapters:true,
    requestMaxAttempts:2,retrySleep:async()=>{},
    collectInMemory:false,
    onBatch:async items=>saved.push(...items),
    onPageCheckpoint:async p=>{nextPage=p.nextPage},
  }),/ECONNRESET/)
  assert.equal(nextPage,4)
  assert.equal(saved.length,2736)
  const resumed=fixture()
  const result=await collectCatalog(root,{
    request:resumed.request,strictPlatformAdapters:true,
    resumePage:nextPage,initialCandidatesCount:saved.length,
    collectInMemory:false,
    requestMaxAttempts:2,retrySleep:async()=>{},
    onBatch:async items=>saved.push(...items),
  })
  assert.equal(result.complete,true)
  assert.equal(result.candidateCount,2736)
  assert.deepEqual(resumed.visitedPages,[4],
    'Only the missing end-of-catalog page should be requested')
  assert.equal(saved.length,2736)
})
