import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {parsePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
import {parseTesseractTsv} from '../server/scanner-pdf-tesseract.mjs'
import {links} from './mama-public-album-links.mjs'
const source=[
 {album:3,photos:[32,33,51,180]},
 {album:4,photos:[39,76,120,132,140]},
]
const x=source[Number(process.env.MAMA_BEST_GROUP)]
if(!x)throw Error('invalid group')
const [name,url]=links[x.album]
const page=await safeRequest(url,{accept:'text/html',maxBytes:24*1024*1024,timeout:20000})
const urls=googlePhotosImageUrls(page.body,10000)
const ops=[
 {w:.25,h:.17,psm:6,target:2200},
 {w:.35,h:.20,psm:6,target:1900},
 {w:.45,h:.25,psm:11,target:1700},
]
for(const n of x.photos){
 try{
 const src=googlePhotosHighResolutionUrl(urls[n-1])||urls[n-1]
 const res=await safeRequest(src,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
 const meta=await sharp(res.buffer).metadata()
 const out=[]
 for(const o of ops){
  const crop=await sharp(res.buffer).extract({
   left:0,top:0,width:Math.ceil(meta.width*o.w),height:Math.ceil(meta.height*o.h),
  }).resize({width:o.target}).grayscale().normalize().sharpen().png().toBuffer()
  for(const model of ['por','por+eng']){
   const p=spawnSync('prlimit',['--as=1073741824','--cpu=18','--fsize=10485760','--',
    'tesseract','stdin','stdout','--tessdata-dir','/tmp/tessbest',
    '--oem','1','-l',model,'--psm',String(o.psm),'tsv',
   ],{input:crop,encoding:'utf8',timeout:25000,maxBuffer:512000})
   const obj=parseTesseractTsv(p.stdout||'')
   out.push({model,psm:o.psm,crop:o.w,price:parsePhotoProductLabel(obj.text).price,
      text:obj.text.replace(/\n+/g,' / ').slice(0,150),exit:p.status})
  }
 }
 console.log('MAMA_TESSBEST '+JSON.stringify({album:name,index:n,variants:out}))
 }catch(e){console.log('MAMA_TESSBEST '+JSON.stringify({album:name,index:n,error:String(e.message)}))}
}
