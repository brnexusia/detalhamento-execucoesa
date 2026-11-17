import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import {safeRequest} from '../server/scanner-collector.mjs'
import {collectSharedPhotos,googlePhotosImageUrls,googlePhotosDetailUrls} from '../server/scanner-photo-albums.mjs'
const links=[
 ['Catálogo Verão', 'https://photos.app.goo.gl/7rFBydymNf2Y5Lfi8'],
 ['Lenços de Verão', 'https://photos.app.goo.gl/uZJuTkVXgEcqDNye7'],
 ['Broches e Chaveiros', 'https://photos.app.goo.gl/xE7JWntJJRo7x1C76'],
 ['Brincos', 'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
 ['Colares - Aros', 'https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9'],
 ['Colares e Maxi Colares', 'https://photos.app.goo.gl/vvusGG4cUbEfzvev7'],
 ['Colares Verniz', 'https://photos.app.goo.gl/4z14SLH91bxMENMX9'],
 ['Pulseiras e Braceletes', 'https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7'],
 ['Chokers e Colares Delicados', 'https://photos.app.goo.gl/4qNDWNyoEig83Dhn9'],
 ['Anéis', 'https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A'],
 ['Cintos', 'https://photos.app.goo.gl/RkuGaNQzA2CFNDCh6'],
 ['Acessórios Cabelo Infantil', 'https://photos.app.goo.gl/WFShKcZthyxqxshMA'],
 ['Catálogo Country', 'https://photos.app.goo.gl/iDwgxFiirce8UfsZ6'],
 ['Acessórios Cabelo Adulto', 'https://photos.app.goo.gl/uwUFrGa1iDKE7iDJ7'],
 ['Acessórios Masculinos', 'https://photos.app.goo.gl/nCj8X8TJ49puAto87'],
 ['Bolsas e Necessaires', 'https://photos.app.goo.gl/dMGADSscxXCJ3VXLA'],
 ['Copos e Porta-joias', 'https://photos.app.goo.gl/4ymqbWGkUmkzpaAa9'],
 ['Brasil Core', 'https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7'],
 ['Catálogo Inverno', 'https://photos.app.goo.gl/GmkVR55GHRgRmHP88'],
 ['Catálogo Inverno Infantil', 'https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9'],
 ['Festa Junina', 'https://photos.app.goo.gl/nHmUk4GjrziN5npD9'],
]


const albumNumber=Number(process.env.MAMA_ALBUM_INDEX)
if(!Number.isInteger(albumNumber)||albumNumber<1||albumNumber>links.length)throw Error('Invalid album index')
const [albumName,albumLink]=links[albumNumber-1]
const outputDir=process.env.MAMA_AUDIT_OUT_DIR||'/tmp/mama-audit-all'
await mkdir(outputDir,{recursive:true})
const tmp=await mkdtemp(path.join(os.tmpdir(),'mama-source-'))
const counts={index:albumNumber,albumName,albumLink,expected:0,downloaded:0,missingPrice:0,
  withPrice:0,validNames:0,skipped:0,invalidMedia:0,missingEvidence:0,notVerified:0,startedAt:new Date().toISOString()}
const items=[]
try {
 const page=await safeRequest(albumLink,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:22000})
 if(!page.ok||new URL(page.url||albumLink).hostname!=='photos.google.com')throw Error('Album not publicly readable')
 const direct=googlePhotosImageUrls(page.body,10000)
 const detail=googlePhotosDetailUrls(page.body,page.url,10000)
 counts.expected=Math.max(direct.length,detail.length)
 counts.rawDirectCount=direct.length
 counts.rawDetailCount=detail.length
 if(!counts.expected)throw Error('No public album photos')
 const savedMedia=new Map()
 const result=await collectSharedPhotos(albumLink,{
  request:async(url,opts)=>{
   if(url===albumLink)return page
   for(let attempt=0;attempt<3;attempt++){
    try{
     const response=await safeRequest(url,opts)
     if([429,502,503].includes(response.status)&&attempt<2){
       await new Promise(ok=>setTimeout(ok,1200*(attempt+1)))
       continue
     }
     return response
    }catch(e){
     if(attempt>=2)throw e
     await new Promise(ok=>setTimeout(ok,1100*(attempt+1)))
    }
   }
  },
  maxProducts:10000,collectInMemory:false,
  onImage:async(buffer,mime,filename)=>{
   assert.equal(mime,'image/webp')
   const meta=await sharp(buffer).metadata()
   if(meta.width<220||meta.height<220)throw Error('Thumbnail image')
   const id=filename.replace(/\.webp$/,'')
   const absolute=path.join(tmp,id+'.webp')
   await writeFile(absolute,buffer)
   const check=await readFile(absolute)
   if(check.length!==buffer.length)throw Error('Media save verification failed')
   savedMedia.set(id,{absolute,width:meta.width,height:meta.height,bytes:buffer.length})
   return '/media/'+id
  },
  onBatch:async batch=>{
   for(const p of batch){
    const ix=Number(/foto-(\d+)/.exec(p.external_id)?.[1]||0)
    const id='foto-album-'+String(ix).padStart(3,'0')
    const meta=savedMedia.get(id)
    const flagged=!(p.price!=null&&p.price>0)
    items.push({index:ix,price:p.price,hasPrice:!flagged,title:p.title,pack:p.pack,
      sku:p.sku,hasName:!p.title.startsWith('Foto importada'),stored:Boolean(meta),
      width:meta?.width,height:meta?.height,imageBytes:meta?.bytes})
    counts.downloaded+=1
    if(flagged)counts.missingPrice+=1
    else counts.withPrice+=1
    if(!p.title.startsWith('Foto importada'))counts.validNames+=1
    if(!meta)counts.invalidMedia+=1
   }
   if(counts.downloaded%100===0)console.log('MAMA_FULL_PROGRESS '+JSON.stringify({index:albumNumber,downloaded:counts.downloaded,expected:counts.expected,priced:counts.withPrice,missing:counts.missingPrice}))
  },
  onProgress:async()=>{},
 })
 counts.skipped=result.skipped
 if(result.candidateCount!==counts.downloaded)throw Error('staging mismatch')
 const missing=items.filter(x=>!x.hasPrice)
 for(let offset=0;offset<missing.length;offset+=24){
  const slice=missing.slice(offset,offset+24)
  const colW=260,rowH=315
  const comps=[]
  for(let i=0;i<slice.length;i++){
   const v=slice[i]
   const src=savedMedia.get('foto-album-'+String(v.index).padStart(3,'0'))?.absolute
   if(!src){counts.missingEvidence++;continue}
   const thumb=await sharp(src).resize({width:250,height:275,fit:'inside'}).jpeg({quality:70}).toBuffer()
   const m=await sharp(thumb).metadata()
   const text='Album '+albumNumber+' #'+v.index
   const svg=Buffer.from('<svg width="260" height="31"><rect width="100%" height="100%" fill="#ececec"/><text x="9" y="22" font-size="17" font-family="sans-serif">'+text+'</text></svg>')
   const left=(i%4)*colW,top=Math.floor(i/4)*rowH
   comps.push({input:svg,left,top})
   comps.push({input:thumb,left:left+Math.round((colW-m.width)/2),top:top+32})
  }
  if(comps.length){
   await sharp({create:{width:colW*4,height:rowH*Math.ceil(slice.length/4),channels:3,background:'#fff'}})
    .composite(comps).jpeg({quality:76}).toFile(path.join(outputDir,'album-'+albumNumber+'-missing-'+String(offset).padStart(4,'0')+'.jpg'))
  }
 }
 counts.finishedAt=new Date().toISOString()
 counts.complete=counts.downloaded===counts.expected&&counts.skipped===0&&counts.invalidMedia===0
 await writeFile(path.join(outputDir,'album-'+albumNumber+'.json'),JSON.stringify({counts,items},null,2))
 console.log('MAMA_FULL_RESULT '+JSON.stringify(counts))
 if(!counts.complete)process.exitCode=1
} catch(err){
 counts.error=String(err?.stack||err).slice(0,1400)
 counts.finishedAt=new Date().toISOString()
 await writeFile(path.join(outputDir,'album-'+albumNumber+'.json'),JSON.stringify({counts,items},null,2)).catch(()=>{})
 console.error('MAMA_FULL_ERROR '+JSON.stringify(counts))
 process.exitCode=1
} finally { await rm(tmp,{recursive:true,force:true}) }
