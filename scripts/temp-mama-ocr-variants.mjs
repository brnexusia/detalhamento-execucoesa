import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {parsePhotoProductLabel,recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
import {parseTesseractTsv} from '../server/scanner-pdf-tesseract.mjs'
import {links} from './mama-public-album-links.mjs'
const index=Number(process.env.MAMA_DIAG_CASE)
const trials=[
 {index:3,positions:[27,32,33,51,180,187,228]},
 {index:4,positions:[18,20,21,39,76,115,117,118,120,132,140]},
 {index:8,positions:[3,8,10,20,30]},
 {index:18,positions:[1,2,3,7,11,15]},
]
if(!Number.isInteger(index)||!trials[index])throw Error('invalid case')
const {index:albumIndex,positions}=trials[index]
const [album,url]=links[albumIndex]
const page=await safeRequest(url,{accept:'text/html',maxBytes:24*1024*1024,timeout:20000})
const images=googlePhotosImageUrls(page.body,10000)
const variants=[
 {id:'top35-psm6-1900',x:0,y:0,w:.35,h:.20,psm:6,width:1900,style:'normalize'},
 {id:'top45-psm6-1900',x:0,y:0,w:.45,h:.25,psm:6,width:1900,style:'normalize'},
 {id:'top32-psm11-sharp',x:0,y:0,w:.32,h:.18,psm:11,width:1900,style:'sharpen'},
 {id:'top45-psm6-threshold',x:0,y:0,w:.45,h:.25,psm:6,width:1700,style:'threshold'},
 {id:'top25-psm7',x:0,y:0,w:.30,h:.16,psm:7,width:2000,style:'sharpen'},
 {id:'top45-psm13',x:0,y:0,w:.45,h:.25,psm:13,width:2000,style:'threshold'},
 {id:'bottomright-psm6',x:.65,y:.65,w:.34,h:.32,psm:6,width:1800,style:'normalize'},
]
for(const n of positions){
 const url=googlePhotosHighResolutionUrl(images[n-1])||images[n-1]
 if(!url){console.log('MAMA_OCR_DIAG '+JSON.stringify({album,photo:n,error:'no URL'}));continue}
 try{
 const file=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000})
 if(!file.ok)throw Error('download '+file.status)
 const meta=await sharp(file.buffer).metadata()
 const previous=await recognizePhotoProductLabel(file.buffer)
 const readings=[]
 for(const v of variants){
  const x=Math.floor(meta.width*v.x),y=Math.floor(meta.height*v.y)
  let p=sharp(file.buffer).extract({
    left:x,top:y,width:Math.min(meta.width-x,Math.ceil(meta.width*v.w)),
    height:Math.min(meta.height-y,Math.ceil(meta.height*v.h)),
  }).resize({width:v.width,kernel:'lanczos3'}).grayscale()
  if(v.style==='threshold')p=p.threshold(170)
  else if(v.style==='sharpen')p=p.normalize().sharpen()
  else p=p.normalize()
  const bytes=await p.png().toBuffer()
  const run=spawnSync('prlimit',[
    '--as=1073741824','--cpu=12','--fsize=10485760','--',
    'tesseract','stdin','stdout','-l','por+eng','--psm',String(v.psm),'tsv',
  ],{input:bytes,encoding:'utf8',timeout:14000,maxBuffer:512000})
  const raw=parseTesseractTsv(run.stdout||'')
  readings.push({id:v.id,result:parsePhotoProductLabel(raw.text),
   text:raw.text.replace(/\n+/g,' / ').slice(0,270),exit:run.status})
 }
 console.log('MAMA_OCR_DIAG '+JSON.stringify({album,photo:n,dimensions:[meta.width,meta.height],
   previous,readings}))
 }catch(e){console.log('MAMA_OCR_DIAG '+JSON.stringify({album,photo:n,error:String(e.message)}))}
}
