import {writeFile} from 'node:fs/promises'
import {performance} from 'node:perf_hooks'
import sharp from 'sharp'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
if(process.env.SHOPVAX_PERF_LOCAL_ONLY!=='1')throw Error('Isolated lab only')
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const page=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
if(!page.ok)throw Error('MAMA album unavailable')
const urls=googlePhotosImageUrls(page.body,100)
if(urls.length<69)throw Error('MAMA sample #69 not found')
const imageUrl=googlePhotosHighResolutionUrl(urls[68])||urls[68]
const response=await safeRequest(imageUrl,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
if(!response.ok||!response.buffer?.length)throw Error('MAMA original photo unavailable')
const image=response.buffer
const first=await recognizePhotoProductLabel(image)
console.log('SHOPVAX_OCR_REFERENCE '+JSON.stringify({expectedPrice:18,recognized:first,bytes:image.length}))
if(first?.price!==18)throw Error('Reference OCR not correct; refusing throughput measurement')
const output=[]
async function sample(concurrency,count){
 let next=0,success=0,failed=0
 const durations=[]
 const start=performance.now(),memBefore=process.memoryUsage().rss
 async function work(){
  while(next<count){
   const n=next++
   const t0=performance.now()
   const label=await recognizePhotoProductLabel(image)
   durations.push(performance.now()-t0)
   if(label?.price===18)success++;else failed++
  }
 }
 await Promise.all(Array.from({length:concurrency},()=>work()))
 const timeMs=performance.now()-start
 const ordered=durations.sort((a,b)=>a-b)
 const obj={
  concurrency,count,recognized:success,missing:failed,
  elapsedMs:Math.round(timeMs),throughputPerSec:Math.round(count/timeMs*100000)/100,
  p95Ms:Math.round(ordered[Math.ceil(.95*ordered.length)-1]||0),
  processRssMB:Math.round(process.memoryUsage().rss/1024/1024),
  rssDeltaMB:Math.round((process.memoryUsage().rss-memBefore)/1024/1024),
 }
 console.log('SHOPVAX_OCR_STRESS '+JSON.stringify(obj))
 output.push(obj)
}
for(const [concurrency,count] of [[4,16],[12,36],[24,48]]){
 await sample(concurrency,count)
}
await writeFile('/tmp/shopvax-ocr-throughput.json',JSON.stringify({
 isolated:true,realTesseract:true,engine:'Tesseract local',results:output,
 note:'Single real MAMA Google Photos image #69 downloaded ONCE; repeated local OCR with 4/12/24 parallel workers. No catalog products are published. Does not include network, storage or queue.'
},null,2))
