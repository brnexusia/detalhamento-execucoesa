import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {parseTesseractTsv} from '../server/scanner-pdf-tesseract.mjs'
import {parsePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
const cases=[
 ['Inverno','https://photos.app.goo.gl/GmkVR55GHRgRmHP88',[1,2,7]],
 ['Inverno Infantil','https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9',[2,3,7]],
 ['Festa Junina','https://photos.app.goo.gl/nHmUk4GjrziN5npD9',[1,5]],
]
const variants=[
 {name:'top35-standard',x:0,y:0,w:.35,h:.20,psm:3,width:1200,method:'normalize'},
 {name:'top45-big-psm6',x:0,y:0,w:.45,h:.25,psm:6,width:1800,method:'normalize'},
 {name:'top50-psm11',x:0,y:0,w:.50,h:.30,psm:11,width:1600,method:'normalize'},
 {name:'top45-threshold',x:0,y:0,w:.45,h:.25,psm:6,width:1600,method:'threshold'},
 {name:'middle60-psm6',x:.20,y:.28,w:.70,h:.35,psm:6,width:1600,method:'normalize'},
 {name:'bottomRight-psm6',x:.55,y:.60,w:.44,h:.36,psm:6,width:1600,method:'normalize'},
]
for(const [name,album,numbers] of cases){
 const page=await safeRequest(album,{accept:'text/html',maxBytes:24*1024*1024,timeout:18000})
 const urls=googlePhotosImageUrls(page.body,20)
 for(const position of numbers){
  const url=googlePhotosHighResolutionUrl(urls[position-1])||urls[position-1]
  const res=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000})
  const meta=await sharp(res.buffer).metadata()
  const readings=[]
  for(const v of variants) {
   const left=Math.floor(meta.width*v.x),top=Math.floor(meta.height*v.y)
   let p=sharp(res.buffer).extract({
      left,top,
      width:Math.min(meta.width-left,Math.ceil(meta.width*v.w)),
      height:Math.min(meta.height-top,Math.ceil(meta.height*v.h)),
   }).resize({width:v.width,kernel:'lanczos3'}).grayscale()
   p=v.method==='threshold'?p.threshold(163):p.normalize()
   const raw=await p.png().toBuffer()
   const proc=spawnSync('prlimit',[
     '--as=1073741824','--cpu=12','--fsize=10485760','--',
     'tesseract','stdin','stdout','-l','por+eng','--psm',String(v.psm),'tsv',
   ],{input:raw,timeout:12000,maxBuffer:600000,encoding:'utf8'})
   const tsv=parseTesseractTsv(proc.stdout||'')
   const fields=parsePhotoProductLabel(tsv.text)
   readings.push({v:v.name,price:fields.price,title:fields.title,pack:fields.pack,
     lines:tsv.lines.slice(0,9).map(z=>z.text),exit:proc.status})
  }
  console.log('MAMA_OCR_VARIANTS '+JSON.stringify({album:name,position,dim:[meta.width,meta.height],readings}))
 }
}
