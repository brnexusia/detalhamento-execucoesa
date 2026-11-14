import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { parsePhotoProductLabel, recognizePhotoProductLabel } from './scanner-photo-ocr.mjs'
import { collectSharedPhotos } from './scanner-photo-albums.mjs'
import { normalizeCandidate } from './scanner-normalizer.mjs'

test('reads the real label layout BRINCO PALHA SINTÉTICA / 1 PÇ / R$12,00',()=>{
  assert.deepEqual(parsePhotoProductLabel('BRINCO PALHA\nSINTÉTICA\n1 PÇ R$ 12,00'), {
    title:'Brinco Palha Sintética',price:12,pack:'1 peça',
  })
})

test('parses quantity separately from monetary amount, including pieces and pairs',()=>{
  assert.deepEqual(parsePhotoProductLabel('CONJUNTO AÇO INOX\n2 PÇS\nR$ 29,90'),{
    title:'Conjunto Aço Inox',price:29.9,pack:'2 peças',
  })
  assert.deepEqual(parsePhotoProductLabel('BRINCO ARGOLA\n1 PAR R$ 14,50'),{
    title:'Brinco Argola',price:14.5,pack:'1 par',
  })
})

test('never invents an unlabeled price or picks between wholesale and retail prices',()=>{
  assert.equal(parsePhotoProductLabel('BRINCO PALHA\n1 PÇ 12,00').price,null)
  assert.equal(parsePhotoProductLabel('BRINCO PALHA\nATACADO R$ 10,00\nVAREJO R$ 15,00').price,null)
  assert.equal(parsePhotoProductLabel('MAMA BIJOUX\nVALOR R$ 12,00').title,'')
})

test('photo collection passes OCR fields into the review and normalization pipeline',async()=>{
  const source='https://photos.app.goo.gl/ocr-album-test'
  const html='<script>"https://lh3.googleusercontent.com/pw/'+ 'A'.repeat(90) +'=w1200-h1600"</script>'
  const batches=[]
  const result=await collectSharedPhotos(source,{
    collectInMemory:false,onProgress:async()=>{},
    request:async()=>({ok:true,url:'https://photos.google.com/share/test-ocr',
      contentType:'text/html',body:html}),
    onImage:async()=>'/media/image-test',
    photoSaver:async()=>({url:'/media/image-test',bytes:5000,label:{
      title:'Brinco Palha Sintética',price:12,pack:'1 peça',
    }}),
    onBatch:async rows=>batches.push(...rows),
  })
  assert.equal(result.candidateCount,1)
  assert.equal(batches[0].title,'Brinco Palha Sintética')
  assert.equal(batches[0].price,12)
  assert.equal(batches[0].pack,'1 peça')
  assert.match(batches[0].description,/1 peça/)
  const normalized=normalizeCandidate(batches[0]).normalized
  assert.equal(normalized.name,'Brinco Palha Sintética')
  assert.equal(normalized.price,12)
  assert.equal(normalized.pack,'1 peça')
  assert.deepEqual(normalized.images,['/media/image-test'])
})

test('OCR failures safely keep the photo, generic name and missing price',async()=>{
  const source='https://photos.app.goo.gl/ocr-missing-test'
  const html='<script>"https://lh3.googleusercontent.com/pw/'+ 'B'.repeat(90) +'=w1200-h1600"</script>'
  const batches=[]
  const result=await collectSharedPhotos(source,{
    collectInMemory:false,onProgress:async()=>{},
    request:async()=>({ok:true,url:'https://photos.google.com/share/test-ocr',
      contentType:'text/html',body:html}),
    onImage:async()=>'/media/image-fallback',
    photoSaver:async()=>({url:'/media/image-fallback',bytes:5000,label:null}),
    onBatch:async rows=>batches.push(...rows),
  })
  assert.equal(result.candidateCount,1)
  assert.equal(batches[0].title,'Foto importada 001')
  assert.equal(batches[0].price,null)
})

test('the OCR preprocessor accepts real image bytes and merges recognized fields',async()=>{
  const image=await sharp({create:{width:640,height:800,channels:3,
    background:{r:245,g:245,b:245}}}).webp().toBuffer()
  let calls=0
  const result=await recognizePhotoProductLabel(image,{
    ocr:async()=>{calls++;return {text:'BRINCO PALHA\nSINTÉTICA\n1 PÇ R$ 12,00'}}
  })
  assert.equal(calls,1)
  assert.deepEqual(result,{title:'Brinco Palha Sintética',price:12,pack:'1 peça'})
})
