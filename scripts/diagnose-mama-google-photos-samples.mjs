// Read-only MAMA Bijoux samples. Each link is passed directly to the Google
// Photos collector, with a two-photo ceiling per album. No Linktree crawling,
// production credentials, store DB access or publication.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { safeRequest } from '../server/scanner-collector.mjs'
import {
  collectSharedPhotos, googlePhotosImageUrls, googlePhotosDetailUrls, sharedPhotoSourceKind,
} from '../server/scanner-photo-albums.mjs'

const albums = [
  ['Verão', 'https://photos.app.goo.gl/7rFBydymNf2Y5Lfi8'],
  ['Brincos', 'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
  ['Pulseiras', 'https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7'],
  ['Cabelo adulto', 'https://photos.app.goo.gl/uwUFrGa1iDKE7iDJ7'],
  ['Bolsas', 'https://photos.app.goo.gl/dMGADSscxXCJ3VXLA'],
]
const results = []
const folder = await mkdtemp(path.join(os.tmpdir(), 'shopvax-google-photos-diagnostic-'))
try {
  for (const [label, link] of albums) {
    const outcome = { album:label, sourceKind:sharedPhotoSourceKind(link) }
    const files = new Map(), products = [], imageAttempts = []
    try {
      const response = await safeRequest(link, {
        accept: 'text/html,application/xhtml+xml',
        maxBytes: 24 * 1024 * 1024,
        timeout: 18000,
      })
      outcome.albumHttp = response.status
      outcome.finalHost = new URL(response.url).hostname
      outcome.contentType = response.contentType.slice(0, 60)
      outcome.htmlBytes = Buffer.byteLength(response.body || '')
      outcome.previewUrls = googlePhotosImageUrls(response.body, 5).length
      outcome.detailUrls = googlePhotosDetailUrls(response.body,response.url,5).length
      if (!response.ok) throw new Error('Falha HTTP no álbum: '+ response.status)
      const result = await collectSharedPhotos(link, {
        request: async (url, options) => {
          if (options.responseType !== 'buffer') return safeRequest(url, options)
          const report={host:new URL(url).hostname}
          try {
            const response=await safeRequest(url,options)
            report.http=response.status
            report.contentType=response.contentType.slice(0,55)
            report.bytes=response.buffer?.length||0
            if (report.bytes && report.http===200) {
              try {
                const meta=await sharp(response.buffer).metadata()
                report.width=meta.width
                report.height=meta.height
                report.format=meta.format
              } catch (error) { report.decodeError=String(error?.message||error).slice(0,75) }
            }
            imageAttempts.push(report)
            return response
          } catch (e) {
            report.error=String(e?.message||e).slice(0,150)
            imageAttempts.push(report)
            throw e
          }
        },
        maxProducts:4,
        collectInMemory:false,
        onProgress:async()=>{},
        onImage:async(bytes,type,filename)=>{
          if (type!=='image/webp') throw new Error('Foto não convertida para WebP')
          const key='/media/diagnostic-'+ (files.size+1)
          const location=path.join(folder,label.replace(/\W/g,'_')+'-'+filename)
          await writeFile(location,bytes)
          files.set(key,{location,size:bytes.length,type})
          return key
        },
        onBatch:async batch=>products.push(...batch),
      })
      outcome.result='ok'
      outcome.photosDownloaded=result.candidateCount
      outcome.photosSkipped=result.skipped
      outcome.savedFiles=files.size
      outcome.reviewImages=products.filter(p=>p.images.length===1&&files.has(p.images[0])).length
      const metas=await Promise.all([...files.values()].map(async f=>{
        const b=await readFile(f.location)
        const meta=await sharp(b).metadata()
        if (b.length!==f.size||meta.format!=='webp'||meta.width<220||meta.height<220) throw new Error('Verificação da foto persistida falhou')
        return {bytes:b.length,width:meta.width,height:meta.height}
      }))
      outcome.savedPhotos=metas
    } catch (e) {
      outcome.result='error'
      outcome.error=String(e?.message||e).slice(0,220)
    }
    outcome.imageAttempts=imageAttempts
    results.push(outcome)
    console.log('MAMA_GOOGLE_PHOTOS_SAMPLE '+JSON.stringify(outcome))
  }
  // Diagnose Google Photos' 54x72px inline thumbnails with a few
  // full-resolution URL variations, without retaining original signed URLs.
  for (const [label, link] of albums.slice(0, 2)) {
    const resp = await safeRequest(link, {
      accept:'text/html,application/xhtml+xml', maxBytes: 24*1024*1024, timeout:18000,
    })
    if(!resp.ok) continue
    const urls = googlePhotosImageUrls(resp.body,7).slice(1,4)
    for(let i=0; i<urls.length; i++) {
      const u = new URL(urls[i])
      const trailing = /=[^/=]+$/.exec(u.pathname)?.[0] || ''
      const variants = ['=w1600-h1600', '=s1600', '=w1200']
      const attempt = { album:label, imageIndex:i+2, originalSizeParam:trailing.slice(0,28), variants:[] }
      for (const dimensions of variants) {
        if (!trailing) continue
        const alternative=new URL(u)
        alternative.pathname=alternative.pathname.slice(0,-trailing.length)+dimensions
        try {
          const response=await safeRequest(alternative, {
            accept:'image/avif,image/webp,image/png,image/jpeg,*/*',
            responseType:'buffer', maxBytes:8*1024*1024,timeout:18000,
          })
          let media={}
          if(response.ok&&response.buffer?.length) {
            try{const meta=await sharp(response.buffer).metadata();media={format:meta.format,width:meta.width,height:meta.height}}
            catch(e){media={decodeError:String(e?.message||e).slice(0,70)}}
          }
          attempt.variants.push({parameter:dimensions,http:response.status,bytes:response.buffer?.length||0,...media})
        }catch(e){attempt.variants.push({parameter:dimensions,error:String(e?.message||e).slice(0,85)})}
      }
      console.log('MAMA_GOOGLE_PHOTOS_RESOLUTION '+JSON.stringify(attempt))
    }
  }
  const ok=results.filter(r=>r.result==='ok').length
  console.log('MAMA_GOOGLE_PHOTOS_SUMMARY '+JSON.stringify({albumsTested:results.length,worked:ok,failed:results.length-ok,photoLimitPerAlbum:4,published:0}))
  if (ok!==results.length) process.exitCode=1
} finally {
  await rm(folder,{recursive:true,force:true})
}
