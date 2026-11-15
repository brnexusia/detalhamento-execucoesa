import sharp from 'sharp'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
const cases=[
  ['Colares Verniz','https://photos.app.goo.gl/4z14SLH91bxMENMX9',[1]],
  ['Chokers','https://photos.app.goo.gl/4qNDWNyoEig83Dhn9',[1]],
  ['Brasil Core','https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7',[1,3]],
  ['Inverno','https://photos.app.goo.gl/GmkVR55GHRgRmHP88',[1,2,3]],
  ['Inverno Infantil','https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9',[2,3]],
  ['Festa Junina','https://photos.app.goo.gl/nHmUk4GjrziN5npD9',[1]],
]
const tiles=[],crops=[],results=[]
let idx=0
function label(s,width,number) {
  const safe=s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  return Buffer.from('<svg width="'+width+'" height="45"><rect width="100%" height="100%" fill="#e8e8e8"/><text x="14" y="30" font-size="19" font-family="sans-serif" fill="#111">'+number+' '+safe+'</text></svg>')
}
for(const [name,album,indices] of cases){
  const page=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
  if(!page.ok)throw Error('Album not accessible: '+name)
  const urls=googlePhotosImageUrls(page.body,10)
  for(const n of indices){
    const source=urls[n-1],final=googlePhotosHighResolutionUrl(source)||source
    const res=await safeRequest(final,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
    if(!res.ok||!res.buffer?.length)throw Error('Photo unavailable: '+name+' '+n)
    const image=await sharp(res.buffer).metadata()
    const recognized=await recognizePhotoProductLabel(res.buffer)
    const x=idx%2*550,y=Math.floor(idx/2)*740
    const picture=await sharp(res.buffer).resize({width:530,height:675,fit:'inside'})
      .jpeg({quality:79}).toBuffer()
    const picMeta=await sharp(picture).metadata()
    tiles.push({input:label(name+' · foto '+n,550,idx+1),left:x,top:y})
    tiles.push({input:picture,left:x+Math.floor((550-picMeta.width)/2),top:y+50})
    const crop=await sharp(res.buffer).extract({
      left:0,top:0,width:Math.ceil(image.width*.6),height:Math.ceil(image.height*.3),
    }).resize({width:530}).jpeg({quality:83}).toBuffer()
    crops.push({input:label(name+' · foto '+n,550,idx+1),left:x,top:Math.floor(idx/2)*440})
    crops.push({input:crop,left:x+10,top:Math.floor(idx/2)*440+50})
    results.push({index:idx+1,album:name,photo:n,dimensions:[image.width,image.height],ocr:recognized})
    idx++
  }
}
const h=Math.ceil(idx/2)
const sheet=await sharp({create:{width:1100,height:740*h,channels:3,background:'#fff'}})
 .composite(tiles).jpeg({quality:75}).toBuffer()
const sheetCrop=await sharp({create:{width:1100,height:440*h,channels:3,background:'#fff'}})
 .composite(crops).jpeg({quality:76}).toBuffer()
for(const x of results) console.log('MAMA_MISSING_VISUAL_ITEM '+JSON.stringify(x))
console.log('MAMA_MISSING_VISUAL_SHEET '+sheet.toString('base64'))
console.log('MAMA_MISSING_CROP_SHEET '+sheetCrop.toString('base64'))
console.log('MAMA_MISSING_VISUAL_SUMMARY '+JSON.stringify({count:results.length,missingOCR:results.filter(x=>x.ocr?.price==null).length}))
