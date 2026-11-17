import sharp from 'sharp'
import {mkdir,writeFile} from 'node:fs/promises'
import {links} from './mama-public-album-links.mjs'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'

const missing={
  0:[94,197,214,273,274,275,276,277,278,279,280,281],
  1:[17,29,138,217,218,219,221,222,226,227,290,291],
  3:[39,47,48,64,65,66,67,68,240,281],
  4:[39,131,132,134,140,141],
  5:[35],6:[1],7:[9,139],
  8:[3,9,15,20,21,22,23,24,25,27],
  9:[45,66,72],10:[205,288],11:[58],
  13:[16,18,187,188,189,190,191,192,193,194,195,196,197,198,199],
  14:[15,67],
  18:[4,10,27,37,51,52,68,74,103,104,105,106,107,108,109,112,113],
  19:[27,40]
}
const rows=Object.entries(missing).flatMap(([album,nums])=>nums.map(photo=>({index:Number(album),photo})))
const shard=Number(process.env.MAMA_RECOVERY_SHARD??0)
const shardCount=Number(process.env.MAMA_RECOVERY_SHARDS??4)
if(!Number.isInteger(shard)||shard<0||shard>=shardCount) throw Error('invalid shard')
const assigned=rows.filter((_,i)=>i%shardCount===shard)
const dir='/tmp/mama-price-recovery'
await mkdir(dir,{recursive:true})
const records=[]
const pages=new Map()
async function downloadPhoto(raw){
 const full=googlePhotosHighResolutionUrl(raw)
 for(const u of full&&full!==raw?[full,raw]:[raw]){
  try{
   const res=await safeRequest(u,{responseType:'buffer',accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.2',maxBytes:8*1024*1024,timeout:25000})
   if(res.ok&&Buffer.isBuffer(res.buffer)&&res.buffer.length)return res.buffer
  }catch{}
 }
 throw Error('image download failed')
}
for (const row of assigned) {
 const [album,url]=links[row.index]
 const record={album,albumIndex:row.index,photo:row.photo,title:'',price:null,pack:'',sku:'',error:null,hasPrice:false}
 try{
  if(!pages.has(row.index)){
   const page=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:25000})
   if(!page.ok)throw Error('album failed')
   pages.set(row.index,googlePhotosImageUrls(page.body,10000))
  }
  const images=pages.get(row.index)
  if(!images[row.photo-1])throw Error('photo unavailable at index '+row.photo)
  const bytes=await downloadPhoto(images[row.photo-1])
  let result=await recognizePhotoProductLabel(bytes)
  if(!result||!result.title||result.price==null){
    const resized=await sharp(bytes).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer()
    const second=await recognizePhotoProductLabel(resized)
    if(second){
      const a=Number(result?.price),b=Number(second.price)
      const va=result?.price!=null&&Number.isFinite(a)&&a>0
      const vb=second.price!=null&&Number.isFinite(b)&&b>0
      const conflict=va&&vb&&Math.abs(a-b)>0.001
      result={title:result?.title||second.title||'',price:conflict?null:(va?a:vb?b:null),pack:result?.pack||second.pack||'',sku:result?.sku||second.sku||''}
    }
  }
  record.title=result?.title||''
  record.price=result?.price??null
  record.pack=result?.pack||''
  record.sku=result?.sku||''
  record.hasPrice=record.price!=null
 }catch(e){record.error=String(e?.message||e).slice(0,200)}
 records.push(record)
 console.log('MAMA_RECOVERY_CASE '+JSON.stringify(record))
}
const summary={shard,assigned:assigned.length,checked:records.length,recovered:records.filter(x=>x.hasPrice).length,stillMissing:records.filter(x=>!x.hasPrice&&!x.error).length,errors:records.filter(x=>x.error).length}
await writeFile(dir+'/shard-'+shard+'.json',JSON.stringify({summary,records},null,2))
console.log('MAMA_RECOVERY_SUMMARY '+JSON.stringify(summary))
if(summary.errors||summary.checked!==summary.assigned)process.exitCode=1
