import {writeFile} from 'node:fs/promises'
import {performance} from 'node:perf_hooks'
import sharp from 'sharp'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
if(process.env.SHOPVAX_PERF_LOCAL_ONLY!=='1')throw Error('Isolated lab only')
const card=Buffer.from(
  '<svg width="900" height="1200" xmlns="http://www.w3.org/2000/svg">'+
  '<rect width="900" height="1200" fill="#ffffff"/>'+
  '<rect x="20" y="18" width="390" height="170" fill="#fefefe" stroke="#555"/>'+
  '<text x="36" y="64" font-family="DejaVu Sans" font-size="36">BRINCO PALHA</text>'+
  '<text x="36" y="104" font-family="DejaVu Sans" font-size="34">SINTETICA</text>'+
  '<text x="36" y="151" font-family="DejaVu Sans" font-size="35">1 PC R$ 18,00</text></svg>',
)
const image=await sharp(card).png().toBuffer()
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
 note:'Synthetic printed 900x1200 photo (not external Google Photos), bounded 4/12/24 parallel OCR tasks. Does not include network, storage or queue.'
},null,2))
