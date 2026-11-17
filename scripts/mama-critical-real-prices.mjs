import assert from 'node:assert/strict'
import sharp from 'sharp'
import { links } from './mama-public-album-links.mjs'
import { safeRequest } from '../server/scanner-collector.mjs'
import { googlePhotosImageUrls, googlePhotosHighResolutionUrl } from '../server/scanner-photo-albums.mjs'
import { recognizePhotoProductLabel } from '../server/scanner-photo-ocr.mjs'

const examples=[
 {album:9,photo:45,expected:7,kind:'exact'},
 {album:1,photo:29,expected:17,kind:'no-false'},
 {album:3,photo:64,expected:null,kind:'no-false'},
 {album:1,photo:291,expected:25,kind:'no-false'},
]
const selected=examples[Number(process.env.MAMA_CRITICAL_CASE??0)]
if(!selected)throw Error('invalid case')
const [album,url]=links[selected.album]
const page=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
assert.ok(page.ok,'album inaccessible')
const photo=googlePhotosImageUrls(page.body,10000)[selected.photo-1]
assert.ok(photo,'photo absent')
let bytes
for(const candidate of [googlePhotosHighResolutionUrl(photo),photo].filter(Boolean)){
 try{
  const r=await safeRequest(candidate,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:22000})
  if(r.ok&&Buffer.isBuffer(r.buffer)){bytes=r.buffer;break}
 }catch{}
}
assert.ok(bytes,'photo unavailable')
const original=await recognizePhotoProductLabel(bytes)
let final=original?.price??null,alternatePrice=null
if(!original||!original.title||original.price==null){
 const optimized=await sharp(bytes).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer()
 const alt=await recognizePhotoProductLabel(optimized)
 alternatePrice=alt?.price??null
 const a=Number(original?.price),b=Number(alt?.price)
 const va=original?.price!=null&&Number.isFinite(a)&&a>0
 const vb=alt?.price!=null&&Number.isFinite(b)&&b>0
 const conflict=va&&vb&&Math.abs(a-b)>0.001
 const hints=original?.unpunctuatedPriceDigits||[]
 const contradictory=!va&&vb&&hints.length>0&&!hints.includes(String(Math.round(b*100)))
 final=conflict||contradictory?null:(va?a:vb?b:null)
}
console.log('MAMA_CRITICAL_REAL '+JSON.stringify({
 album,photo:selected.photo,kind:selected.kind,expected:selected.expected,
 original:original?.price??null,originalTitle:original?.title||'',
 hints:original?.unpunctuatedPriceDigits||[],alternatePrice,final
}))
if(selected.kind==='exact') assert.equal(final,selected.expected,'visible printed price must be recovered')
if(selected.kind==='no-false') assert.ok(final===null||final===selected.expected,
 'OCR value contradicts photographed label; do not publish')
