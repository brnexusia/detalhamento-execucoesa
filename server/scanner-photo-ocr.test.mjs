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

test('discards unrelated OCR fragments rather than putting gibberish into product names',()=>{
  assert.equal(parsePhotoProductLabel('BRINCO ”\n1 PÇ R$ 16,00').title,'Brinco')
  assert.equal(parsePhotoProductLabel('BRINCO ait 1 PG\n1 PÇ R$ 16,00').title,'Brinco')
  assert.equal(parsePhotoProductLabel('BRINCO ‘the\n1 PÇ R$ 16,00').title,'Brinco')
  assert.equal(parsePhotoProductLabel('BOLSA COM ALÇA AS 1 PG\n1 PÇ R$ 85,00').title,'Bolsa Com Alça')
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


test('recovers R$ 7,00 after upscaling small printed price labels rather than guessing R$ 700',async()=>{
  const image=await sharp({create:{width:600,height:750,channels:3,
    background:{r:242,g:242,b:240}}}).webp().toBuffer()
  let calls=0
  const result=await recognizePhotoProductLabel(image,{
    ocr:async prepared=>{
      calls++
      const meta=await sharp(prepared).metadata()
      assert.equal(meta.width,1200, 'printed label must be enlarged for OCR')
      return {text:'BRINCO\n1 PÇ R$ 7,00'}
    },
  })
  assert.equal(calls,1)
  assert.deepEqual(result,{title:'Brinco',price:7,pack:'1 peça'})
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ R$ 700').price,null,
    'never infer decimal position from 700')
})

test('recognizes conservative OCR currency variants with explicit decimal cents',()=>{
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ RS 7,00').price,7)
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ R§ 7,00').price,7)
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ R$ 7.00').price,7)
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ 7,00').price,null)
  assert.equal(parsePhotoProductLabel('BRINCO\n1 PÇ RS 700').price,null)
  assert.equal(parsePhotoProductLabel('BRINCO\nVAREJO RS 10,00\nATACADO R$ 7,00').price,null)
})


test('reads top-left R$ 18,00 price before competing magazine text can mislead OCR',async()=>{
  const photo=await sharp({create:{width:640,height:800,channels:3,
    background:{r:245,g:245,b:245}}}).webp().toBuffer()
  const calls=[]
  const result=await recognizePhotoProductLabel(photo,{ocr:async (prepared,psm)=>{
    const meta=await sharp(prepared).metadata()
    calls.push({psm,width:meta.width,height:meta.height})
    if(psm===3)return {text:'BRINCO\nPÇ R$ 18,00'}
    return {text:'BRINCO\n1 PÇ R$ 15,00'}
  }})
  assert.deepEqual(calls.map(c=>c.psm),[3,11])
  assert.equal(calls[0].width,1200)
  assert.ok(calls[0].height > 300)
  assert.deepEqual(result,{title:'Brinco',price:18,pack:'1 peça'})
})

test('wide second-pass OCR recovers price when the narrow label crop lacks it',async()=>{
  const photo=await sharp({create:{width:640,height:800,channels:3,
    background:{r:245,g:245,b:245}}}).webp().toBuffer()
  const calls=[]
  const result=await recognizePhotoProductLabel(photo,{ocr:async (_prepared,psm)=>{
    calls.push(psm)
    return {text:psm===3?'BRINCO':'BRINCO\n1 PÇ R$ 22,90'}
  }})
  assert.deepEqual(calls,[3,11])
  assert.deepEqual(result,{title:'Brinco',price:22.9,pack:'1 peça'})
})
