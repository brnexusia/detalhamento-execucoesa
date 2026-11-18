/**
 * Focused, image-backed audit for the 117 OCR misses from the complete
 * 2026-11-16 MAMA run (3980 downloaded photos, 3863 parsed prices).
 *
 * Re-downloads public source pixels, rather than guessing cents from OCR's
 * ambiguous "R$ 700" or reusing lossy 270px preview thumbnails.
 * The archive contains one full JPEG + a top-label crop per missing item,
 * and a source-key manifest. Never publishes or touches a database.
 *
 * MAMA_REVIEW_ALBUM_INDEX=0 node scripts/mama-review-99p5.mjs
 */
import sharp from 'sharp'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {links} from './mama-public-album-links.mjs'

export const baselineExpectedCounts=[
  289,296,168,300,144,285,25,300,300,191,300,300,61,300,106,300,59,18,130,70,38,
]
export const baselineMissing={
  0:[94,197,214,273,274,275,276,277,278,279,280,281],
  1:[17,29,32,138,217,218,219,220,221,222,224,226,227,290,291],
  2:[54],
  3:[12,13,14,15,16,187,228],
  4:[39,119,131,132,134,140,141],
  5:[14,15,19,35,38],
  6:[1],
  7:[9,104,105,139],
  8:[3,9,15,20,21,22,23,24,25,27,212],
  9:[17,38,45,51,64,65,66,72,80,96,122,124,138],
  10:[205,288],
  11:[58],
  13:[16,18,36,187,188,189,190,191,192,193,194,195,196,197,198,199],
  14:[15,67],
  18:[10,27,37,51,52,64,68,74,85,103,104,105,106,107,108,109,112,113],
  19:[27,40],
}
const albumIndex=Number(process.env.MAMA_REVIEW_ALBUM_INDEX)
if(!Number.isInteger(albumIndex)||!baselineMissing[albumIndex])throw Error('Índice de álbum não listado no diagnóstico de 117 fotos.')
const [album,url]=links[albumIndex]
const out='/tmp/mama-99p5-evidence/album-'+String(albumIndex+1).padStart(2,'0')
await mkdir(out,{recursive:true})
const response=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:22000})
if(!response.ok||new URL(response.url||url).hostname!=='photos.google.com')throw Error('Álbum Google Fotos inacessível.')
const urls=googlePhotosImageUrls(response.body,10000)
if(urls.length!==baselineExpectedCounts[albumIndex])
  throw Error('Álbum mudou de ordem/quantidade desde auditoria: '+album+
    ' (esperadas '+baselineExpectedCounts[albumIndex]+', atuais '+urls.length+'). Reconciliar antes de associar preços.')
const records=[]
for(const photo of baselineMissing[albumIndex]){
  const originalUrl=urls[photo-1]
  if(!originalUrl)throw Error('Foto não encontrada no índice '+photo)
  let image=null
  for(const source of [googlePhotosHighResolutionUrl(originalUrl),originalUrl].filter(Boolean)){
    try{
      const r=await safeRequest(source,{
        responseType:'buffer',
        accept:'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.2',
        maxBytes:8*1024*1024,
        maxOutputBytes:8*1024*1024,timeout:22000,
      })
      if(r.ok&&Buffer.isBuffer(r.buffer)&&r.buffer.length){image=r.buffer;break}
    }catch{}
  }
  if(!image)throw Error('Foto não baixada: álbum '+album+', foto '+photo)
  const s=sharp(image,{limitInputPixels:40_000_000,failOn:'error'})
  const meta=await s.metadata()
  const name='photo-'+String(photo).padStart(4,'0')
  const whole=await sharp(image,{limitInputPixels:40_000_000})
    .rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
    .jpeg({quality:90,mozjpeg:true}).toBuffer()
  await writeFile(path.join(out,name+'-whole.jpg'),whole)
  const w=meta.width,h=meta.height
  // Keep native source pixels before enlarging. The price comma often
  // vanishes in the compact 270px audit thumbnail but is visible here.
  const top=await sharp(image,{limitInputPixels:40_000_000}).rotate()
    .extract({left:0,top:0,width:w,height:Math.max(1,Math.floor(h*0.32))})
    .resize({width:Math.max(1600,Math.min(2200,w*2)),withoutEnlargement:false})
    .normalize().jpeg({quality:93,mozjpeg:true}).toBuffer()
  await writeFile(path.join(out,name+'-top.jpg'),top)
  const key=(()=>{
    try{return new URL(originalUrl).pathname.replace(/=[^/=]+$/,'').split('/').at(-1).slice(-22)}
    catch{return ''}
  })()
  records.push({photo,sourceImageKey:key,sourceAlbum:url,originalDimensions:[w,h],
    top:name+'-top.jpg',whole:name+'-whole.jpg'})
  console.log('MAMA_99P5_PHOTO '+JSON.stringify({albumIndex,photo,sourceImageKey:key}))
}
const report={albumIndex,album,sourceUrl:url,sourceCount:urls.length,missing:records.length,photos:records}
await writeFile(path.join(out,'manifest.json'),JSON.stringify(report,null,2))
console.log('MAMA_99P5_ALBUM '+JSON.stringify({albumIndex,album,photos:records.length,allSaved:true}))
