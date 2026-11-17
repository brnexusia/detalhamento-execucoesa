/**
 * One-time exhaustive public-image audit for 21 MAMA Google Photos albums.
 * Each shard handles every 4th URL. Downloads actual high-resolution bytes,
 * runs the production OCR, verifies WebP output, and records missing-price
 * photos. Never connects to a user DB or publishes anything.
 */
import sharp from 'sharp'
import {mkdir,writeFile} from 'node:fs/promises'
import {safeRequest} from '../server/scanner-collector.mjs'
import {
 googlePhotosImageUrls,googlePhotosHighResolutionUrl,googlePhotosDetailUrls,
} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
import {links} from './mama-public-album-links.mjs'

const index=Number(process.env.MAMA_ALBUM_INDEX)
const shard=Number(process.env.MAMA_PHOTO_SHARD)
const shardCount=Number(process.env.MAMA_PHOTO_SHARD_COUNT||4)
if(!Number.isInteger(index)||index<0||index>=links.length)throw Error('invalid album')
if(!Number.isInteger(shard)||shard<0||shard>=shardCount)throw Error('invalid shard')
const [album,url]=links[index]
const dir='/tmp/mama-fixed-exhaustive'
await mkdir(dir,{recursive:true})
let photos=[]
const page=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
if(!page.ok||new URL(page.url||url).hostname!=='photos.google.com')throw Error('Public Google Photos album not accessible '+album)
photos=googlePhotosImageUrls(page.body,10000)
const details=googlePhotosDetailUrls(page.body,page.url,10000)
if(photos.length<=1&&details.length>1)throw Error('Album detail-pages-only, cannot verify all photos directly '+album)
if(!photos.length)throw Error('No photos in album '+album)
const assigned=photos.map((link,n)=>({link,n:n+1})).filter((_,n)=>n%shardCount===shard)
const records=[],bad=[]
let downloaded=0,decodeErrors=0,priced=0,named=0,pack=0,skuCount=0,ocrNull=0
let totalMs=0
function keyFromUrl(url){
 try{
  const u=new URL(url)
  return u.pathname.replace(/=[^/=]+$/,'').split('/').at(-1).slice(-22)
 }catch{return ''}
}
async function getImage(link){
 const high=googlePhotosHighResolutionUrl(link)
 const sources=high&&high!==link?[high,link]:[link]
 for(const u of sources){
  try{
   const r=await safeRequest(u,{
    accept:'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.2',
    responseType:'buffer',maxBytes:8*1024*1024,maxOutputBytes:8*1024*1024,
    timeout:18000,
   })
   if(r?.ok&&Buffer.isBuffer(r.buffer)&&r.buffer.length)return r.buffer
  }catch{}
 }
 return null
}
for(const img of assigned){
 const start=Date.now()
 const item={photo:img.n,key:keyFromUrl(img.link),status:'failed',name:'',price:null,pack:'',dimensions:[]}
 let image
 try{
  image=await getImage(img.link)
  if(!image){item.error='download_failed';decodeErrors++;records.push(item);continue}
  const info=await sharp(image,{limitInputPixels:40_000_000,failOn:'error'}).metadata()
  if(!info.width||!info.height||info.width<220||info.height<220)throw Error('resolution<220')
  item.dimensions=[info.width,info.height]
  const stored=await sharp(image,{limitInputPixels:40_000_000})
    .rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
    .webp({quality:85}).toBuffer()
  const valid=await sharp(stored).metadata()
  if(valid.format!=='webp'||stored.length<1000)throw Error('bad WebP conversion')
  downloaded++
  let result=await recognizePhotoProductLabel(image)
  if(result===null)ocrNull++
  // Mirror the production importer's conservative second pass: run the
  // stored WebP only for incomplete labels, preserve exact originals and
  // require review for conflicting explicit prices.
  if(!result || !result.title || result.price==null){
    const fallback=await recognizePhotoProductLabel(stored)
    if(fallback){
      const a=Number(result?.price),b=Number(fallback.price)
      const hasA=result?.price!=null&&Number.isFinite(a)&&a>0
      const hasB=fallback.price!=null&&Number.isFinite(b)&&b>0
      const conflict=hasA&&hasB&&Math.abs(a-b)>0.001
      result={
        title:result?.title||fallback.title||'',
        price:conflict?null:(hasA?a:hasB?b:null),
        pack:result?.pack||fallback.pack||'',
        sku:result?.sku||fallback.sku||'',
      }
    }
  }
  item.name=String(result?.title||'')
  item.price=result?.price??null
  item.pack=String(result?.pack||'')
  item.sku=String(result?.sku||'')
  if(item.name)named++
  if(item.price!==null)priced++
  if(item.pack)pack++
  if(item.sku)skuCount++
  item.status='ok'
  if(item.price===null) {
   bad.push({photo:img.n,name:item.name,pack:item.pack,link:img.link})
   // Small indexed preview for manual inspection. Not the full image.
   const width=270,height=350
   const thumb=await sharp(image).resize({width:width-8,height:height-35,fit:'inside'})
     .jpeg({quality:73}).toBuffer()
   const tm=await sharp(thumb).metadata()
   item.previewData={
      base64:thumb.toString('base64'),width:tm.width,height:tm.height,
   }
  }
 }catch(e){item.error=String(e?.message||e).slice(0,140);decodeErrors++}
 finally{
  item.elapsedMs=Date.now()-start
  totalMs+=item.elapsedMs
  records.push(item)
  if(records.length%10===0)console.log('MAMA_FULL_PROGRESS '+JSON.stringify({
   album,shard,completed:records.length,assigned:assigned.length,downloaded,priced,
   missing:bad.length,failed:decodeErrors,elapsedSec:Math.round(totalMs/1000),
  }))
 }
}
const summary={
 index:index+1,album,url,shard,shards:shardCount,enumerated:photos.length,
 assigned:assigned.length,checked:records.length,downloaded,downloadErrors:decodeErrors,
 withPrice:priced,missingPrice:bad.length,withName:named,withPack:pack,withSku:skuCount,ocrNull,
 ms:totalMs,readComplete:assigned.length===records.length&&downloaded===assigned.length,
 missingIndices:bad.map(o=>o.photo),failureIndices:records.filter(o=>o.status!=='ok').map(o=>o.photo),
}
const prefix=dir+'/album-'+String(index+1).padStart(2,'0')+'-shard-'+shard
await writeFile(prefix+'.json',JSON.stringify({
 summary,records:records.map(({previewData,...rest})=>rest)
},null,2))
if(bad.length){
  // Store proof/contact sheets only as temporary artifact, not in repository.
  const failures=records.filter(x=>x.previewData)
  const perSheet=20
  for(let off=0;off<failures.length;off+=perSheet){
   const slice=failures.slice(off,off+perSheet)
   const cw=270,ch=350,cols=4,rows=Math.ceil(slice.length/cols)
   const layers=[]
   for(let i=0;i<slice.length;i++){
    const z=slice[i],xx=(i%cols)*cw,yy=Math.floor(i/cols)*ch
    const indexLabel=String(z.photo).padStart(4,'0')
    const title=Buffer.from('<svg width="'+cw+'" height="32"><rect width="100%" height="100%" fill="#eee"/><text x="8" y="23" font-family="sans-serif" font-size="20">#'+indexLabel+'</text></svg>')
    const picture=Buffer.from(z.previewData.base64,'base64')
    layers.push({input:title,left:xx,top:yy})
    layers.push({input:picture,left:xx+Math.floor((cw-z.previewData.width)/2),top:yy+32})
   }
   const sheet=await sharp({create:{
     width:cw*cols,height:ch*rows,channels:3,background:'#fff'
   }}).composite(layers).jpeg({quality:72,mozjpeg:true}).toBuffer()
   await writeFile(prefix+'-missing-'+String(Math.floor(off/perSheet)+1)+'.jpg',sheet)
  }
}
console.log('MAMA_FULL_SUMMARY '+JSON.stringify(summary))
if(!summary.readComplete)process.exitCode=1
