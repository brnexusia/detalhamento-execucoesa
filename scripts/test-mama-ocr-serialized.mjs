import assert from 'node:assert/strict'
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
const first=await recognizePhotoProductLabel(source)
assert.equal(first?.price,18,'source photo #69 must show R$ 18,00')
const started=Date.now()
const count=8
const responses=await Promise.all(Array.from({length:count},()=>recognizePhotoProductLabel(source)))
const prices=responses.map(x=>x?.price??null)
console.log('MAMA_OCR_STABILITY '+JSON.stringify({photos:count,prices,allCorrect:prices.every(x=>x===18),ms:Date.now()-started}))
assert.ok(prices.every(x=>x===18),'overloaded OCR must not silently drop price on concurrent jobs')
