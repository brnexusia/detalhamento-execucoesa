import sharp from 'sharp'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
const cases=[
 ['Lenços Verão','https://photos.app.goo.gl/uZJuTkVXgEcqDNye7',[4]],
 ['Colares Aros','https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',[4]],
 ['Colares Verniz','https://photos.app.goo.gl/4z14SLH91bxMENMX9',[1]],
 ['Chokers','https://photos.app.goo.gl/4qNDWNyoEig83Dhn9',[3,8]],
 ['Brasil Core','https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7',[1,3,4,5]],
 ['Inverno','https://photos.app.goo.gl/GmkVR55GHRgRmHP88',[1,2,3,7]],
 ['Inverno Infantil','https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9',[2,3,4,7,8]],
 ['Festa Junina','https://photos.app.goo.gl/nHmUk4GjrziN5npD9',[1,5,6,7]],
]
const data=[]
const photo=[]
for(const [name,album,indices] of cases){
 const page=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
 if(!page.ok)throw Error('Album not accessible: '+name)
 const urls=googlePhotosImageUrls(page.body,10)
 for(const n of indices){
   const raw=urls[n-1]
   if(!raw)throw Error('No image '+name+' #'+n)
   const url=googlePhotosHighResolutionUrl(raw)||raw
   const res=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
   if(!res.ok||!res.buffer?.length)throw Error('Photo missing '+name+' #'+n)
   const resized=await sharp(res.buffer).resize({width:500,height:620,fit:'inside'})
      .jpeg({quality:75}).toBuffer()
   const meta=await sharp(resized).metadata()
   data.push({album:name,index:n,order:data.length+1})
   photo.push({bytes:resized,width:meta.width,height:meta.height})
 }
}
for(let sheetId=0;sheetId<2;sheetId++){
 const selected=data.slice(sheetId*11,sheetId*11+11)
 const composites=[],colW=540,rowH=700
 for(let i=0;i<selected.length;i++){
   const d=selected[i],img=photo[d.order-1],x=(i%2)*colW,y=Math.floor(i/2)*rowH
   const title=(d.order+'. '+d.album+' foto '+d.index)
     .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
   const svg=Buffer.from('<svg width="'+colW+'" height="54"><rect width="100%" height="100%" fill="#eee"/><text x="12" y="34" font-family="sans-serif" font-size="24" fill="#111">'+title+'</text></svg>')
   composites.push({input:svg,left:x,top:y})
   composites.push({input:img.bytes,left:x+Math.floor((colW-img.width)/2),top:y+60})
 }
 const image=await sharp({create:{width:1080,height:Math.ceil(selected.length/2)*rowH,channels:3,background:'#fff'}})
  .composite(composites).jpeg({quality:76,mozjpeg:true}).toBuffer()
 console.log('MAMA_EXPANDED_VISUAL_SHEET_'+sheetId+' '+image.toString('base64'))
}
console.log('MAMA_EXPANDED_VISUAL_LIST '+JSON.stringify(data))
