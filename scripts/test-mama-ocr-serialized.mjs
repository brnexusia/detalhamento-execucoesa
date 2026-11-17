import assert from 'node:assert/strict'
import sharp from 'sharp'
import {writeFile} from 'node:fs/promises'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
const page=await safeRequest('https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6',{
 accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
assert.equal(page.ok,true)
const photos=googlePhotosImageUrls(page.body,100)
assert.ok(photos.length>=69)
const url=googlePhotosHighResolutionUrl(photos[68])||photos[68]
const response=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
assert.equal(response.ok,true)
const source=response.buffer
await writeFile('/tmp/mama-ocr-reference-photo69.jpg',await sharp(source).resize({width:800}).jpeg({quality:80}).toBuffer())
const first=await recognizePhotoProductLabel(source)
console.log('MAMA_OCR_REFERENCE_NOW '+JSON.stringify({price:first?.price,title:first?.title,pack:first?.pack}))
if(first?.price!==18){
 const {spawnSync}=await import('node:child_process')
 const {parseTesseractTsv}=await import('../server/scanner-pdf-tesseract.mjs')
 const {parsePhotoProductLabel}=await import('../server/scanner-photo-ocr.mjs')
 const variations=[]
 await recognizePhotoProductLabel(source,{ocr:async(buffer,psm)=>{
  const run=spawnSync('prlimit',[
   '--as=1073741824','--cpu=12','--fsize=10485760','--',
   'tesseract','stdin','stdout','-l','por+eng','--psm',String(psm),'tsv',
  ],{input:buffer,timeout:12000,maxBuffer:1000000,encoding:'utf8'})
  const result=parseTesseractTsv(run.stdout||'')
  variations.push({psm,exit:run.status,parsed:parsePhotoProductLabel(result.text),
    raw:result.text.slice(0,520)})
  return result
 }})
 console.log('MAMA_OCR_PRICE_CONFLICT '+JSON.stringify(variations))
}
assert.ok(Number.isFinite(first?.price)&&first.price>0,'reference photo should expose a labeled price')
const started=Date.now()
const count=8
const responses=await Promise.all(Array.from({length:count},()=>recognizePhotoProductLabel(source)))
const prices=responses.map(x=>x?.price??null)
console.log('MAMA_OCR_STABILITY '+JSON.stringify({photos:count,prices,reference:first?.price,allCorrect:prices.every(x=>x===first.price),ms:Date.now()-started}))
assert.ok(prices.every(x=>x===first.price),'overloaded OCR must not silently drop price on concurrent jobs')
