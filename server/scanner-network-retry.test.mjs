import test from 'node:test'
import assert from 'node:assert/strict'
import { isTransientScannerNetworkError, retryScannerRequest } from './scanner-network-retry.mjs'

test('ECONNRESET is retried on the same FácilZap POST page, preserving request body',async()=>{
  let calls=0
  const optionsSeen=[]
  const request=retryScannerRequest(async(url,options)=>{
    calls++
    optionsSeen.push({url,options})
    if(calls<=2)throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'})
    return {status:200,ok:true,body:'{"produtos":[{"id":1}]}',url}
  },{maxAttempts:5,sleep:async()=>{}})
  const opts={method:'POST',body:{pagina_especifica:'',some:'unchanged'},headers:{'content-type':'application/json'}}
  const result=await request('https://facilzap.com.br/galegobijoux/carregar_produtos/7/todas/123',opts)
  assert.equal(result.status,200)
  assert.equal(calls,3)
  assert.ok(optionsSeen.every(x=>x.options===opts && x.url===optionsSeen[0].url))
})

test('HTTP 429 / 503 transient pagination errors are retried and respect Retry-After',async()=>{
  const waits=[]
  let calls=0
  const wrapped=retryScannerRequest(async()=>{
    calls++
    return calls===1?{status:429,ok:false,headers:{'retry-after':'2'}}
      :calls===2?{status:503,ok:false,headers:{}}
      :{status:200,ok:true,body:'{}'}
  },{sleep:async ms=>{waits.push(ms)}})
  assert.equal((await wrapped('https://facilzap.com.br/page')).status,200)
  assert.equal(calls,3)
  assert.deepEqual(waits,[2000,700])
})

test('fatal HTTP 403/404 must not be retried',async()=>{
  for(const status of [400,401,403,404]){
    let count=0
    const wrapped=retryScannerRequest(async()=>{count++;return {status,ok:false}})
    assert.equal((await wrapped('https://shop.example/')).status,status)
    assert.equal(count,1)
  }
})

test('retry attempts are bounded and non-network parser failures still throw',async()=>{
  let attempts=0
  const wrapped=retryScannerRequest(async()=>{
    attempts++
    throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'})
  },{maxAttempts:4,sleep:async()=>{}})
  await assert.rejects(wrapped('https://facilzap.com.br/p'),/socket hang up/)
  assert.equal(attempts,4)
  assert.equal(isTransientScannerNetworkError(new Error('A paginação pública do FácilZap respondeu HTTP 503.')),true)
  assert.equal(isTransientScannerNetworkError(new Error('A paginação repetiu a página 4')),false)
})
