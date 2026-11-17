import assert from 'node:assert/strict'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
const samples=[
 ['https://photos.app.goo.gl/xE7JWntJJRo7x1C76',54,17],
 ['https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',119,17],
 ['https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',131,17],
 ['https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',141,17],
 ['https://photos.app.goo.gl/vvusGG4cUbEfzvev7',14,17],
 ['https://photos.app.goo.gl/vvusGG4cUbEfzvev7',19,17],
 ['https://photos.app.goo.gl/vvusGG4cUbEfzvev7',38,17],
 ['https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7',9,17],
 ['https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7',104,17],
 ['https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7',105,17],
 ['https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A',17,7],
 ['https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A',64,7],
]
const albums=new Map()
let pass=0,fail=0
for(const [album,index,expected] of samples){
 let arr=albums.get(album)
 if(!arr){
  const page=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
  if(!page.ok)throw Error('Album not accessible')
  arr=googlePhotosImageUrls(page.body,10000)
  albums.set(album,arr)
 }
 const raw=arr[index-1]
 assert.ok(raw,'Missing reference photo '+index)
 const url=googlePhotosHighResolutionUrl(raw)||raw
 const res=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:22000})
 assert.equal(res.ok,true)
 const start=Date.now()
 const item=await recognizePhotoProductLabel(res.buffer)
 const ok=item?.price===expected
 if(ok)pass++;else fail++
 console.log('MAMA_RAPID_INTEGRATION '+JSON.stringify({album,index,expected,price:item?.price??null,title:item?.title||'',ok,elapsedMs:Date.now()-start}))
}
console.log('MAMA_RAPID_INTEGRATION_SUMMARY '+JSON.stringify({photos:samples.length,passed:pass,failed:fail}))
assert.equal(fail,0,'All visually validated MAMA sticker prices must match, not merely be filled')
