import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
const root='/tmp/mama-data',dir='/tmp/mama-audit-aggregate'
await mkdir(dir,{recursive:true})
async function find(p){
 const entries=await readdir(p,{withFileTypes:true})
 const out=[]
 for(const e of entries){
  const sub=path.join(p,e.name)
  if(e.isDirectory())out.push(...await find(sub))
  else if(e.name.endsWith('.json')&&e.name.startsWith('album-'))out.push(sub)
 }
 return out
}
const files=await find(root)
const baselines=[],summaryByAlbum=new Map()
for(const file of files){
 const result=JSON.parse(await readFile(file,'utf8'))
 if(!result.summary?.album||!Array.isArray(result.records))continue
 baselines.push(result)
 const s=result.summary
 const prev=summaryByAlbum.get(s.index)||{
  index:s.index,album:s.album,url:s.url,enumerated:s.enumerated,
  shards:[],checked:0,downloaded:0,missing:0,named:0,packed:0,priced:0,
  downloadErrors:0,ocrNull:0,missingIndices:[],failureIndices:[],
 }
 if(prev.enumerated!==s.enumerated)throw Error('Album enumeration drifted '+s.album)
 prev.shards.push(s.shard)
 prev.checked+=s.checked;prev.downloaded+=s.downloaded;prev.missing+=s.missingPrice
 prev.named+=s.withName;prev.packed+=s.withPack;prev.priced+=s.withPrice
 prev.downloadErrors+=s.downloadErrors;prev.ocrNull+=s.ocrNull
 prev.missingIndices.push(...s.missingIndices)
 prev.failureIndices.push(...s.failureIndices)
 summaryByAlbum.set(s.index,prev)
}
const albums=[...summaryByAlbum.values()].sort((a,b)=>a.index-b.index)
const summary={
 checked:albums.reduce((v,a)=>v+a.checked,0),
 enumerated:albums.reduce((v,a)=>v+a.enumerated,0),
 downloaded:albums.reduce((v,a)=>v+a.downloaded,0),
 priceFound:albums.reduce((v,a)=>v+a.priced,0),
 priceMissing:albums.reduce((v,a)=>v+a.missing,0),
 names:albums.reduce((v,a)=>v+a.named,0),
 packs:albums.reduce((v,a)=>v+a.packed,0),
 imageErrors:albums.reduce((v,a)=>v+a.downloadErrors,0),
 albums:albums.length,shards:baselines.length,
}
const missing=[]
for(const b of baselines){
 for(const row of b.records.filter(x=>x.price===null||x.status!=='ok')){
  missing.push({album:b.summary.album,albumIndex:b.summary.index,
    photo:row.photo,name:row.name,price:row.price,
    dimensions:row.dimensions,error:row.error||null})
 }
}
const valid=summary.albums===21&&summary.shards===84&&
 summary.checked===summary.enumerated&&summary.downloaded===summary.enumerated&&
 summary.imageErrors===0&&
 albums.every(x=>x.checked===x.enumerated&&new Set(x.shards).size===4)
const report={valid,generatedAt:new Date().toISOString(),summary,albums,missing}
await writeFile(dir+'/baseline.json',JSON.stringify(report,null,2))
console.log('MAMA_BASELINE_AGGREGATE '+JSON.stringify({valid,summary,albums:albums.map(({index,album,checked,priced,missing})=>({index,album,checked,priced,missing}))}))
if(!valid)process.exitCode=1
