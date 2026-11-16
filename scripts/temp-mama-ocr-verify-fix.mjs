import sharp from 'sharp'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
const groups=[
 {name:'Brincos',url:'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6',indices:[27,32,33,51,180]},
 {name:'Colares - Aros',url:'https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',
  indices:[18,20,21,39,76,115,117,118,120,132,140]},
 {name:'Chokers',url:'https://photos.app.goo.gl/4qNDWNyoEig83Dhn9',indices:[3,10,20,30]},
]
const group=groups[Number(process.env.MAMA_VERIFY_GROUP)]
if(!group)throw Error('Unknown group')
const r=await safeRequest(group.url,{accept:'text/html',maxBytes:24*1024*1024,timeout:20000})
const urls=googlePhotosImageUrls(r.body,10000)
let read=0,missed=0,failed=0
for(const n of group.indices){
 try{
   const u=googlePhotosHighResolutionUrl(urls[n-1])||urls[n-1]
   if(!u)throw Error('no link')
   const res=await safeRequest(u,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000})
   if(!res.ok||!res.buffer?.length)throw Error('no image')
   const label=await recognizePhotoProductLabel(res.buffer)
   const priced=label?.price!==null&&label?.price!==undefined
   if(priced)read++;else missed++
   console.log('MAMA_FIX_SPOT '+JSON.stringify({album:group.name,index:n,price:label?.price,
       name:label?.title||'',pack:label?.pack||'',dimensions:(await sharp(res.buffer).metadata()).width}))
 }catch(e){failed++;console.log('MAMA_FIX_SPOT '+JSON.stringify({album:group.name,index:n,error:String(e.message)}))}
}
console.log('MAMA_FIX_SPOT_SUMMARY '+JSON.stringify({album:group.name,total:group.indices.length,priced:read,missing:missed,failed}))
if(failed)process.exitCode=1
