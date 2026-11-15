import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { safeRequest } from '../server/scanner-collector.mjs'
import { googlePhotosImageUrls,googlePhotosHighResolutionUrl } from '../server/scanner-photo-albums.mjs'
import { recognizePhotoProductLabel } from '../server/scanner-photo-ocr.mjs'
import { parseTesseractTsv } from '../server/scanner-pdf-tesseract.mjs'

const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const page=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:18000})
if(!page.ok)throw Error('Google Photos album unreachable')
const images=googlePhotosImageUrls(page.body,100)
const position=69
if(images.length<position)throw Error('Album has fewer images than target')
const url=googlePhotosHighResolutionUrl(images[position-1])||images[position-1]
const resp=await safeRequest(url,{
  responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000,
})
if(!resp.ok||!resp.buffer?.length)throw Error('Target image unavailable')
const original=await sharp(resp.buffer).metadata()
const optimized=await sharp(resp.buffer).rotate()
  .resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
  .webp({quality:85}).toBuffer()
const attempts=[]
const result=await recognizePhotoProductLabel(optimized,{
  ocr:async (bytes,psm)=>{
    const meta=await sharp(bytes).metadata()
    const p=spawnSync('prlimit',[
      '--as=1073741824','--cpu=12','--fsize=10485760','--',
      'tesseract','stdin','stdout','-l','por+eng','--psm',String(psm),'tsv',
    ],{input:bytes,encoding:'utf8',timeout:14000,maxBuffer:1024*1024})
    const parsed=parseTesseractTsv(p.stdout||'')
    attempts.push({psm,dimensions:[meta.width,meta.height],exit:p.status,
      lines:parsed.lines.slice(0,16).map(x=>x.text)})
    return parsed
  },
})
console.log('MAMA_PHOTO69_OCR '+JSON.stringify({
  index:position,originalDimensions:[original.width,original.height],
  result,attempts,
}))

const bare=images[position-1]
const high=new URL(bare)
if(!/=[^/=]+$/.test(high.pathname))high.pathname+='=w1600-h1600'
else high.pathname=high.pathname.replace(/=[^/=]+$/,'=w1600-h1600')
const highResponse=await safeRequest(high.toString(),{
 responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000,
})
if(!highResponse.ok)throw Error('High-resolution source unavailable: '+highResponse.status)
const highMeta=await sharp(highResponse.buffer).metadata()
const highOptimized=await sharp(highResponse.buffer).rotate()
 .resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
 .webp({quality:85}).toBuffer()
const highAttempts=[]
const highResult=await recognizePhotoProductLabel(highOptimized,{ocr:async(bytes,psm)=>{
 const meta=await sharp(bytes).metadata()
 const p=spawnSync('prlimit',[
  '--as=1073741824','--cpu=12','--fsize=10485760','--',
  'tesseract','stdin','stdout','-l','por+eng','--psm',String(psm),'tsv',
 ],{input:bytes,encoding:'utf8',timeout:14000,maxBuffer:1024*1024})
 const parsed=parseTesseractTsv(p.stdout||'')
 highAttempts.push({psm,dimensions:[meta.width,meta.height],exit:p.status,
   lines:parsed.lines.slice(0,16).map(x=>x.text)})
 return parsed
}})
console.log('MAMA_PHOTO69_FORCED_HIGHRES '+JSON.stringify({
 index:position,http:highResponse.status,originalDimensions:[highMeta.width,highMeta.height],
 result:highResult,attempts:highAttempts,
}))
