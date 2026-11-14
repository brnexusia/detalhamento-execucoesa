import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { safeRequest } from '../server/scanner-collector.mjs'
import { collectSharedPhotos } from '../server/scanner-photo-albums.mjs'
import { recognizePhotoProductLabel,parsePhotoProductLabel } from '../server/scanner-photo-ocr.mjs'
import { parseTesseractTsv } from '../server/scanner-pdf-tesseract.mjs'

// Read-only sample: only first 25 public photos in one MAMA Google album.
// Images are not persisted; no tenant store database and no publishing.
const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
let number=0,missing=0,found=0
const rejected=[]
const rows=[]
async function analyze(buffer) {
  number++
  const item=await recognizePhotoProductLabel(buffer)
  if(item?.price != null)found++
  else {
    missing++
    const meta=await sharp(buffer).metadata()
    const variants=[
      {label:'top55-psm6',width:.55,height:.20,psm:6},
      {label:'top55-psm11',width:.55,height:.20,psm:11},
      {label:'top82-psm6',width:.82,height:.38,psm:6},
    ]
    const alternatives=[]
    for(const variant of variants){
      const prep=await sharp(buffer).extract({
        left:0,top:0,width:Math.ceil(meta.width*variant.width),
        height:Math.ceil(meta.height*variant.height),
      }).resize({width:1200}).grayscale().normalize().png().toBuffer()
      const result=spawnSync('prlimit',[
        '--as=1073741824','--cpu=12','--fsize=10485760','--',
        'tesseract','stdin','stdout','-l','por+eng','--psm',String(variant.psm),'tsv',
      ],{input:prep,encoding:'utf8',maxBuffer:512*1024,timeout:15000})
      const lines=parseTesseractTsv(result.stdout||'').lines.slice(0,8)
      const text=lines.map(x=>x.text).join('\n')
      alternatives.push({variant:variant.label,lines:lines.map(x=>({text:x.text,score:+x.score.toFixed(2)})),
        fields:parsePhotoProductLabel(text)})
    }
    if(rejected.length<12)rejected.push({index:number,item,alternatives})
  }
  return item
}
const result=await collectSharedPhotos(album,{
  request:safeRequest,maxProducts:25,collectInMemory:false,
  readLabel:analyze,
  onImage:async()=>'/media/diagnostic-image',
  onBatch:async batch=>rows.push(...batch.map(p=>({title:p.title,price:p.price,pack:p.pack}))),
  onProgress:async()=>{},
})
for(const rejectedRow of rejected)console.log('MAMA_MISSING_PRICE '+JSON.stringify(rejectedRow))
console.log('MAMA_MISSING_PRICE_SUMMARY '+JSON.stringify({
  requested:25,downloaded:result.candidateCount,skipped:result.skipped,
  ocrRead:number,recognizedPrices:found,missingPrices:missing,
  names:rows.filter(p=>!p.title.startsWith('Foto importada')).length,
}))
