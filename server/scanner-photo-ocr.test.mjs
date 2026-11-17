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


test('chooses the explicitly labelled single-piece price over dozen discount',()=>{
  assert.deepEqual(parsePhotoProductLabel('CACHECOL CRIANÇA\n1 PÇ R$ 20,00\nDZ R$ 220,00'),{
    title:'Cachecol Criança',price:20,pack:'1 peça',
  })
  assert.deepEqual(parsePhotoProductLabel('BICO DE PATO\n1 PÇ R$ 9,00\nDZ R$ 100,00'),{
    title:'Bico De Pato',price:9,pack:'1 peça',
  })
  assert.deepEqual(parsePhotoProductLabel('CALÇA MEIA\n1 PC R$ 25,00\nDZ RS 280,00'),{
    title:'Calça Meia',price:25,pack:'1 peça',
  })
})

test('does not choose an arbitrary unit price when photo contains two separate products',()=>{
  const two='TIARA INSPIRAÇÃO BRASIL\n1 PÇ R$ 38,00\nLENÇO BRASIL\n1 PÇ R$ 35,00'
  assert.equal(parsePhotoProductLabel(two).price,null)
  assert.equal(parsePhotoProductLabel('CACHECOL\n1 PÇ R$ 38,00\nDZ R$ 440,00').price,38)
  assert.equal(parsePhotoProductLabel('CACHECOL\nATACADO R$ 33,00\nVAREJO R$ 44,00').price,null)
})

test('tries middle and lower OCR regions when sticker is not in a corner',async()=>{
  const image=await sharp({create:{width:900,height:1600,channels:3,background:'#fff'}})
    .jpeg().toBuffer()
  const calls=[]
  const actual=await recognizePhotoProductLabel(image,{
    ocr:async (_buffer,psm)=>{
      calls.push(psm)
      if(calls.length===4)return {text:'CACHECOL\n1 PÇ R$ 38,00\nDZ R$ 440,00'}
      return {text:'CACHECOL'}
    },
  })
  assert.deepEqual(calls,[3,11,11,11])
  assert.deepEqual(actual,{title:'Cachecol',price:38,pack:'1 peça'})
})


test('accepts Tesseract 1 PÇ glyph substitutions only with explicit BRL cents',()=>{
  assert.deepEqual(parsePhotoProductLabel('CACHECOL CRIANÇA\nIPC R$ 20,00\nDZ R$ 220,00'),{
    title:'Cachecol Criança',price:20,pack:'1 peça',
  })
  assert.deepEqual(parsePhotoProductLabel('CALÇA MEIA\nIPG R$ 25,00\nDZ R$ 280,00'),{
    title:'Calça Meia',price:25,pack:'1 peça',
  })
  assert.equal(parsePhotoProductLabel('BICO DE PATO JUNINA\nIPÇ R$ 10,00\nDZ R$ 110,00').price,10)
  assert.equal(parsePhotoProductLabel('BICO DE PATO\n1P¢ R$ 9,00\nDZ R$ 100,00').price,9)
  assert.equal(parsePhotoProductLabel('CACHECOL\nal 1 PÇ R$ 38,00\nDE R$ 440,00').price,38)
  assert.equal(parsePhotoProductLabel('IPG R$ 100\nDZ R$ 110,00').price,null,
    'a dozen-only price must never be mistaken for the product unit price')
})

test('does not guess a price for several different unit tags in the same image',()=>{
  assert.equal(parsePhotoProductLabel('TIARA\nIPC R$ 38,00\nLENÇO\nIPÇ R$ 35,00').price,null)
  assert.equal(parsePhotoProductLabel('CACHECOL\nIPC R$ 20,00\nVAREJO R$ 30,00').price,20)
  assert.equal(parsePhotoProductLabel('CACHECOL\nIPG R$ 2000').price,null)
  assert.equal(parsePhotoProductLabel('CACHECOL\nDZ R$ 220,00').price,null)
  assert.equal(parsePhotoProductLabel('CACHECOL\nDE R$ 440,00').price,null)
})


test('uses threshold OCR on a small top-left sticker before guessing from background',async()=>{
  const img=await sharp({create:{width:1200,height:1600,channels:3,background:'#fff'}})
    .jpeg().toBuffer()
  const attempts=[]
  const result=await recognizePhotoProductLabel(img,{ocr:async(bytes,psm)=>{
    const meta=await sharp(bytes).metadata()
    attempts.push({psm,width:meta.width})
    return {text:attempts.length===3?'COLAR E BRINCO\n1 PC R$ 17,00':'COLAR E BRINCO'}
  }})
  assert.equal(attempts.length,3)
  assert.deepEqual(attempts.map(x=>x.psm),[3,11,11])
  assert.equal(attempts[2].width,1700)
  assert.equal(result.price,17)
  assert.equal(result.pack,'1 peça')
})

test('recognizes a bottom-right promotion label without treating image texture as price',async()=>{
  const img=await sharp({create:{width:1200,height:1600,channels:3,background:'#ddd'}})
    .jpeg().toBuffer()
  const attempts=[]
  const result=await recognizePhotoProductLabel(img,{ocr:async(bytes,psm)=>{
    const meta=await sharp(bytes).metadata()
    attempts.push({psm,width:meta.width})
    return {text:attempts.length===7
      ? 'CACHECOL COM POMPOM\nPROMOÇÃO\n1P¢ R$ 20,00'
      : ''}
  }})
  assert.equal(attempts.length,7)
  assert.equal(attempts.at(-1).psm,6)
  assert.equal(attempts.at(-1).width,1600)
  assert.equal(result.price,20)
})


test('second-pass sticker OCR recovers cents after the original seven crops lost the comma',async()=>{
  const photo=await sharp({create:{width:1200,height:1600,channels:3,background:'#ddd'}})
    .jpeg().toBuffer()
  const calls=[]
  const result=await recognizePhotoProductLabel(photo,{ocr:async(buffer,psm)=>{
    calls.push({psm,width:(await sharp(buffer).metadata()).width})
    if(calls.length===8)return {text:'COLAR\n1 PÇ R$ 17,00'}
    return {text:'COLAR\n1 PC R$ 1700'}
  }})
  assert.equal(calls.length,8)
  assert.equal(calls[7].psm,6)
  assert.equal(calls[7].width,1900)
  assert.deepEqual(result,{title:'Colar',price:17,pack:'1 peça'})
})

test('one failed OCR crop does not wipe out fields recovered by other crop',async()=>{
  const photo=await sharp({create:{width:720,height:960,channels:3,background:'#fff'}})
    .jpeg().toBuffer()
  let calls=0
  const result=await recognizePhotoProductLabel(photo,{ocr:async()=>{
    calls++
    if(calls===1)throw Error('Tesseract timeout on first image crop')
    return {text:'BRINCO PALHA\n1 PÇ R$ 12,00'}
  }})
  assert.equal(calls,2)
  assert.deepEqual(result,{title:'Brinco Palha',price:12,pack:'1 peça'})
})

test('never guesses cents from missing separators even with second-pass OCR',async()=>{
  const photo=await sharp({create:{width:900,height:1200,channels:3,background:'#eee'}})
    .jpeg().toBuffer()
  const result=await recognizePhotoProductLabel(photo,{
    ocr:async()=>({text:'COLAR\n1 PÇ R$ 1700'}),
  })
  assert.equal(result.price,null)
  assert.equal(result.title,'Colar')
})

test('reads SKU only when explicitly printed; cleans code labels from the product name', () => {
  assert.deepEqual(parsePhotoProductLabel('BRINCO DE AÇO\nREF: BR-2048\n1 PÇ R$ 15,00'), {
    title:'Brinco De Aço',price:15,pack:'1 peça',sku:'BR-2048',
  })
  assert.deepEqual(parsePhotoProductLabel('BOLSA PALHA SINTÉTICA CÓDIGO: 80719\n1 PÇ R$ 140,00'),{
    title:'Bolsa Palha Sintética',price:140,pack:'1 peça',sku:'80719',
  })
  assert.equal(parsePhotoProductLabel('ANEL\n1 PÇ R$ 7,00').sku,undefined)
  assert.equal(parsePhotoProductLabel('ANEL\nREF 123456\nREF 999999\n1 PÇ R$ 7,00').sku,undefined,
    'two different identifiers need manual review')
  assert.equal(parsePhotoProductLabel('COLAR\nREF: TESTE\n1 PÇ R$ 29,90').sku,undefined,
    'a generic text reference is not a trusted product identifier')
})

test('Google Photos keeps a printed SKU through review and normalization; description stays evidence-based',async()=>{
 const url='https://photos.app.goo.gl/sku-check'
 const images='https://lh3.googleusercontent.com/pw/'+ 'A'.repeat(90) +'=w1600-h1200'
 const batch=[]
 await collectSharedPhotos(url,{
  collectInMemory:false,onProgress:async()=>{},
  request:async()=>({ok:true,url:'https://photos.google.com/share/photo-sku',contentType:'text/html',body:'<script>"'+images+'"</script>'}),
  onImage:async()=>'/media/sku-test',
  photoSaver:async()=>({url:'/media/sku-test',bytes:5000,label:{
   title:'Brinco De Aço',price:15,pack:'1 peça',sku:'BR-2048',
  }}),
  onBatch:async rows=>batch.push(...rows),
 })
 assert.equal(batch.length,1)
 assert.equal(batch[0].sku,'BR-2048')
 assert.match(batch[0].description,/1 peça/)
 const normalized=normalizeCandidate(batch[0]).normalized
 assert.equal(normalized.sku,'BR-2048')
 assert.equal(normalized.name,'Brinco De Aço')
 assert.equal(normalized.price,15)
})


test('extra focused OCR pass recovers a real small-label decimal after legacy crops fail', async()=>{
  const img=await sharp({create:{width:1200,height:1600,channels:3,background:'#f7f7f7'}}).png().toBuffer()
  let calls=0
  const found=await recognizePhotoProductLabel(img,{ocr:async(_buffer,psm)=>{
    calls++
    if(calls===15) {
      assert.equal(psm,7)
      return {text:'ANEL\\n1 PÇ R$ 7,00'}
    }
    return {text: 'ANEL\\n1 PÇ R$ 700'}
  }})
  assert.equal(calls,15)
  assert.equal(found?.price,7)
})

test('extra focused OCR never interprets R$ 700 as 7,00', async()=>{
  const img=await sharp({create:{width:1200,height:1600,channels:3,background:'#f7f7f7'}}).png().toBuffer()
  const result=await recognizePhotoProductLabel(img,{ocr:async()=>({text:'ANEL\\n1 PÇ R$ 700'})})
  assert.equal(result?.price,null)
})
