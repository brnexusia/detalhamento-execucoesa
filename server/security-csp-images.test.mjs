import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import './security-hooks.mjs'

test('scanner review can render Alexandre and FácilZap product images while CSP remains restrictive', async () => {
  const app=express()
  app.get('/painel/produtos',(_req,res)=>res.status(200).send('ok'))
  const server=await new Promise(resolve=>{
    const instance=app.listen(0,'127.0.0.1',()=>resolve(instance))
  })
  try {
    const address=server.address()
    const response=await fetch('http://127.0.0.1:'+address.port+'/painel/produtos')
    const csp=response.headers.get('content-security-policy')||''
    const img=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('img-src '))||''
    const script=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('script-src '))||''
    const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '))||''
    assert.equal(response.status,200)
    assert.ok(img.includes('https://ilsnxeayzpgdjzktwowq.supabase.co'))
    assert.ok(img.includes('https://arquivos.facilzap.app.br'))
    assert.ok(img.includes("'self'"))
    assert.ok(!img.includes('https: '),'do not allow arbitrary https images')
    assert.ok(!img.includes('*.supabase.co'),'do not allow every Supabase tenant')
    assert.ok(!script.includes('supabase.co'))
    assert.ok(!connect.includes('supabase.co'))
    assert.ok(!script.includes('facilzap.app.br'))
    assert.ok(!connect.includes('facilzap.app.br'))
  } finally {
    await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))
  }
})
