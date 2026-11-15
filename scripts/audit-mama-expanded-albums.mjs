// Final verification uses direct-source OCR, targeted 1700px threshold scans and binary lower-right labels.
// Read-only smoke test for ALL 21 Google Photos links listed in
// https://linktr.ee/CatalogoMAMAbijoux on 2026-11-14.
// Checks album access and inventory of image URLs; downloads at most EIGHT
// photos per album with the actual Atacado Shop importer, validating saved
// bytes, resized WebP and OCR fields. No production DB or publication.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
const part=Number(process.env.MAMA_AUDIT_PART??'0')
if(![0,1,2].includes(part))throw new Error('MAMA_AUDIT_PART must be 0,1,2')
const chunk=links.slice(part*7,(part+1)*7)
const result=[]
const dir=await mkdtemp(path.join(os.tmpdir(),'mama-all-albums-'))
try {
 for(let i=0;i<chunk.length;i++) {
  const [title,link]=chunk[i]
  const item={index:part*7+i+1,title,link,access:'not_checked',photoCounts:{},imagesStored:0,readableImages:0,ocrNames:0,ocrPrices:0,ocrPacks:0,status:'failed'}
  const products=[]
  try {
   const response=await safeRequest(link,{
     accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000,
   })
   item.http=response.status
   item.finalHost=new URL(response.url||link).hostname
   item.access=response.ok&&item.finalHost==='photos.google.com'&&String(response.contentType).includes('html')
     ? 'ok':'failed'
   if(item.access!=='ok')throw new Error('Álbum não abriu como Google Fotos público')
   const totalImageUrls=googlePhotosImageUrls(response.body,10000)
   const totalDetailUrls=googlePhotosDetailUrls(response.body,response.url,10000)
   item.photoCounts={imageUrls:totalImageUrls.length,detailUrls:totalDetailUrls.length}
   if(!totalImageUrls.length && !totalDetailUrls.length)throw new Error('Nenhuma imagem exposta no HTML do álbum')
   const fileRecords=[]
   const albumResult=await collectSharedPhotos(link,{
     request:async(url,opts)=>url===link?response:safeRequest(url,opts),
     maxProducts:8,collectInMemory:false,onProgress:async()=>{},
     onImage:async(buffer,mime,filename)=>{
       if(!Buffer.isBuffer(buffer)||mime!=='image/webp')throw new Error('Image not saved in WebP')
       const meta=await sharp(buffer).metadata()
       if(meta.format!=='webp'||meta.width<220||meta.height<220)throw new Error('Image missing quality')
       const absolute=path.join(dir,String(part)+'-'+String(i)+'-'+filename)
       await writeFile(absolute,buffer)
       const verified=await readFile(absolute)
       if(verified.length!==buffer.length||verified.length<=1000)throw new Error('Bytes not saved')
       const url='/media/audit-'+(fileRecords.length+1)
       fileRecords.push({url,width:meta.width,height:meta.height,bytes:buffer.length})
       return url
     },
     onBatch:async batch=>products.push(...batch),
   })
   item.imagesStored=fileRecords.length
   item.readableImages=products.filter(p=>p.images?.length===1&&fileRecords.some(f=>f.url===p.images[0])).length
   item.ocrNames=products.filter(p=>!String(p.title||'').startsWith('Foto importada')).length
   item.ocrPrices=products.filter(p=>p.price!=null&&p.price>0).length
   item.ocrPacks=products.filter(p=>Boolean(p.pack)).length
   item.sampleAttempted=Math.min(8,totalImageUrls.length||totalDetailUrls.length)
   item.skipped=albumResult.skipped
   item.status=item.imagesStored>=1&&item.readableImages===item.imagesStored&&item.skipped===0?'ok':'partial'
   item.resolution=fileRecords.map(f=>[f.width,f.height])
   item.issues=products.map((p,j)=>({
     // only sample index, not source signed photo URLs
     sampleIndex:j+1, missingPrice:p.price==null, genericName:String(p.title).startsWith('Foto importada')
   })).filter(p=>p.missingPrice || p.genericName)
  } catch(error) {
    item.error=String(error?.message||error).slice(0,260)
    if(item.access==='ok')item.status='failed'
  }
  result.push(item)
  console.log('MAMA_ALL_LINK '+JSON.stringify(item))
 }
 const summary={
   part,albums:result.length,accessible:result.filter(x=>x.access==='ok').length,
   testedOK:result.filter(x=>x.status==='ok').length,
   partial:result.filter(x=>x.status==='partial').length,
   failed:result.filter(x=>x.status==='failed').length,
   imagesStored:result.reduce((s,x)=>s+x.imagesStored,0),
   pricesRead:result.reduce((s,x)=>s+x.ocrPrices,0),
 }
 console.log('MAMA_ALL_SUMMARY '+JSON.stringify(summary))
 if(summary.failed||summary.partial)process.exitCode=1
} finally { await rm(dir,{recursive:true,force:true}) }
