import assert from 'node:assert/strict'
import sharp from 'sharp'
import { collectSharedPhotos, googlePhotosImageUrls, googlePhotosDetailUrls, sharedPhotoSourceKind, MAX_ALBUM_ITEMS, photoImportConcurrency } from './scanner-photo-albums.mjs'

const photoA = 'https://lh3.googleusercontent.com/pw/' + 'A'.repeat(90)
const photoB = 'https://lh3.googleusercontent.com/pw/' + 'B'.repeat(90)
const avatar = 'https://lh3.googleusercontent.com/a-/avatar123=w300'

assert.equal(sharedPhotoSourceKind('https://photos.app.goo.gl/abc'), 'google-photos')
assert.equal(sharedPhotoSourceKind('https://photos.google.com/share/abc'), 'google-photos')
assert.equal(sharedPhotoSourceKind('https://images.example.test/product.jpg?signature=abc'), 'image-link')
assert.equal(sharedPhotoSourceKind('https://example.com/catalogo'), '')
assert.deepEqual(googlePhotosImageUrls('https://localhost/internal.png'), [])

const html = `<!doctype html><html><body>
  <script>window.album=["${photoA}=w240-h240","${photoA}=w1200-h800","${photoB.replaceAll('/', '\\/')}=w900-h900"]</script>
  <img src="${avatar}"/>
</body></html>`
const extracted = googlePhotosImageUrls(html)
assert.equal(extracted.length, 2, 'same photo sizes must be deduplicated')
assert.ok(extracted[0].includes('=w1200-h800'), 'prefer highest-resolution variant')
assert.ok(extracted[1].includes('/pw/' + 'B'.repeat(90)))

const jpeg = await sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 180, g: 90, b: 70 } } }).jpeg().toBuffer()
const storage = []
const batches = []
const progress = []
const albumUrl = 'https://photos.app.goo.gl/album-test'
const options = {
  request: async (url, requestOptions) => {
    if (url === albumUrl) return {
      ok: true, status: 200, url: 'https://photos.google.com/share/public-test',
      contentType: 'text/html; charset=UTF-8', body: html,
    }
    assert.equal(requestOptions.responseType, 'buffer')
    return { ok: true, status: 200, contentType: 'image/jpeg', buffer: jpeg }
  },
  onImage: async (bytes, type, name) => {
    assert.equal(type, 'image/webp')
    assert.match(name, /^foto-album-\d{3}\.webp$/)
    assert.ok(bytes.length > 0)
    storage.push({ bytes, type, name })
    return '/media/asset-' + storage.length
  },
  onBatch: async (rows) => batches.push(...rows),
  onProgress: async (event) => progress.push(event),
  collectInMemory: false,
}
const result = await collectSharedPhotos(albumUrl, options)
assert.equal(result.platform, 'google-photos')
assert.equal(result.candidateCount, 2)
assert.equal(result.candidates.length, 0, 'streaming mode avoids retaining all products')
assert.equal(storage.length, 2, 'images persisted inside own store through callback')
assert.equal(batches.length, 2)
assert.equal(batches[0].price, null, 'do not invent price')
assert.equal(batches[0].images[0], '/media/asset-1')
assert.equal(batches[0].title, 'Foto importada 001')
assert.notEqual(batches[0].source_url, batches[1].source_url)
assert.equal(progress.at(-1).platform, 'google-photos')

const directResult = await collectSharedPhotos('https://example.test/photo.jpg?token=xyz', {
  ...options,
  collectInMemory: true,
  request: async (_url, requestOptions) => {
    assert.equal(requestOptions.responseType, 'buffer')
    return { ok: true, status: 200, contentType: 'image/jpeg', buffer: jpeg }
  },
})
assert.equal(directResult.platform, 'image-link')
assert.equal(directResult.candidates.length, 1)
assert.equal(directResult.candidates[0].price, null)

await assert.rejects(() => collectSharedPhotos(albumUrl, {
  ...options,
  request: async () => ({ ok: false, status: 403 }),
}), /Álbum inacessível/)

await assert.rejects(() => collectSharedPhotos(albumUrl, {
  ...options,
  request: async () => ({ ok: true, status: 200, contentType: 'text\/html', url: 'https:\/\/photos.google.com/share/private', body: '<html>login required<\/html>' }),
}), /Nenhuma foto pública/)


// A single public album may contain far more photos than the former 120-item cap.
// Exercise the full 10,000-item pipeline with a mocked media encoder, so CI
// checks batching and memory retention without decoding 10,000 physical images.
const bulkUrls = Array.from({ length: MAX_ALBUM_ITEMS + 50 }, (_, i) =>
  'https://lh3.googleusercontent.com/pw/' + i.toString(36).padStart(80, 'A') + '=w1200-h1200')
const bulkHtml = '<html><script>' + bulkUrls.join('\\n') + '</script></html>'
assert.equal(MAX_ALBUM_ITEMS, 10_000)
assert.equal(googlePhotosImageUrls(bulkHtml).length, 10_000, 'album discovery must not stop at 120')
assert.equal(googlePhotosImageUrls(bulkHtml, 75).length, 75, 'explicit request limit must still apply')

let mediaCounter = 0
let stagedCount = 0
const batchSizes = []
let firstStaged = null
let lastStaged = null
const bulkResult = await collectSharedPhotos('https://photos.app.goo.gl/bulk-test', {
  request: async (_url, requestOptions) => {
    assert.equal(requestOptions.maxBytes, 24 * 1024 * 1024)
    return { ok: true, status: 200, url: 'https://photos.google.com/share/bulk-test', contentType: 'text/html', body: bulkHtml }
  },
  onImage: async () => { throw new Error('Bulk simulation must use stubbed encoder') },
  photoSaver: async () => ({ url: '/media/asset-bulk-' + (++mediaCounter), bytes: 1024 }),
  onBatch: async (rows) => {
    assert.ok(rows.length > 0 && rows.length <= 100, 'bounded candidate batches')
    firstStaged ??= rows[0]
    lastStaged = rows.at(-1)
    stagedCount += rows.length
    batchSizes.push(rows.length)
  },
  onProgress: async () => {},
  maxProducts: Number.POSITIVE_INFINITY,
  collectInMemory: false,
})
assert.equal(bulkResult.candidateCount, 10_000)
assert.equal(bulkResult.candidates.length, 0)
assert.equal(mediaCounter, 10_000)
assert.equal(stagedCount, 10_000)
assert.equal(batchSizes.length, 100)
assert.ok(batchSizes.every((n) => n === 100))
assert.equal(firstStaged.price, null)
assert.equal(lastStaged.title, 'Foto importada 10000')
assert.equal(bulkResult.skipped, 0)

console.log('[scanner albums] limits: 10,000 items, bounded batches, mocked large album: ok')
console.log('[scanner albums] URL, Google Photos public album, tenant media callback, missing price, privacy: ok')


// Regression: public album HTML can expose just a cover image; each photo
// detail is then publicly readable at its own /share/.../photo/... path.
const detailAlbum='https://photos.google.com/share/albumSafe123?key=publicKey'
const detailA=detailAlbum.replace('?key=publicKey','/photo/photoA123?key=publicKey')
const detailB=detailAlbum.replace('?key=publicKey','/photo/photoB456?key=publicKey')
const detailHtml='<html><head><meta property="og:image" content="'+photoA+'=w120-h120"/></head><body>'+
  '<a href="/share/albumSafe123/photo/photoA123?key=publicKey">A</a>'+
  '<a href="/share/albumSafe123/photo/photoB456?key=publicKey">B</a>'+
  '<a href="/share/otherAlbum/photo/privatePhoto123?key=secret">Foreign</a></body></html>'
assert.deepEqual(googlePhotosDetailUrls(detailHtml, detailAlbum),[detailA,detailB])
const photoPages={
  [detailA]:'<meta property="og:image" content="'+photoA+'=w1200-h900">',
  [detailB]:'<meta property="og:image" content="'+photoB+'=w1200-h900">',
}
const detailedStored=[]
const detailed=await collectSharedPhotos(detailAlbum,{
  onImage:options.onImage,
  photoSaver:async url=>{
    detailedStored.push(url)
    return {url:'/media/detail-'+detailedStored.length,bytes:1024}
  },
  collectInMemory:true,
  onProgress:async()=>{},
  request:async url=>{
    if(url===detailAlbum)return {ok:true,url:detailAlbum,contentType:'text/html',body:detailHtml}
    assert.ok([detailA,detailB].includes(url),'fetch only same-album public photo detail')
    return {ok:true,url,contentType:'text/html',body:photoPages[url]}
  },
})
assert.equal(detailed.candidateCount,2,'must import all public photo links, not only cover')
assert.equal(new Set(detailedStored).size,2)
assert.ok(detailedStored.every(src=>src.includes('=w1200-h900')))
assert.ok(detailed.candidates.every(item=>item.price===null && item.images[0].startsWith('/media/')))
assert.deepEqual(googlePhotosDetailUrls(detailHtml,'https://photos.google.com/share/anotherAlbum?key=k'),[])
console.log('[scanner albums] public photo-detail discovery and album boundary: ok')


assert.equal(photoImportConcurrency(undefined),2,'parallel image OCR defaults to bounded 2')
assert.equal(photoImportConcurrency('1'),1,'small VPS can fall back to sequential')
assert.equal(photoImportConcurrency('3'),3)
assert.equal(photoImportConcurrency('200'),3,'never allow unbounded Tesseract processes')
assert.equal(photoImportConcurrency('not-a-number'),2)

const parallelAlbum='https://photos.app.goo.gl/parallel-safe-test'
const parallelUrls=Array.from({length:8},(_,i)=>
  'https://lh3.googleusercontent.com/pw/' + ('A'+String(i).padStart(3,'0')).repeat(23) + '=w1600-h1600')
const parallelHtml='<html><script>'+parallelUrls.join('\n')+'</script></html>'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const parallelRun=async limit=>{
  const original=process.env.SHOPVAX_GOOGLE_PHOTOS_CONCURRENCY
  process.env.SHOPVAX_GOOGLE_PHOTOS_CONCURRENCY=String(limit)
  const staged=[],progress=[]
  let active=0,peak=0
  try{
    const began=Date.now()
    const result=await collectSharedPhotos(parallelAlbum,{
      request:async url=>{
        assert.equal(url,parallelAlbum)
        return {ok:true,status:200,url:'https://photos.google.com/share/parallel-safe-test',
          contentType:'text/html',body:parallelHtml}
      },
      onImage:async()=>{throw Error('stubbed photoSaver must not call onImage')},
      photoSaver:async(url,_request,_onImage,filename)=>{
        const index=parallelUrls.indexOf(url)
        assert.ok(index>=0)
        active++
        peak=Math.max(peak,active)
        try{
          // Deliberately finish the second item first. The saved review
          // product list MUST remain in source album order.
          await delay(index%2===0?25:5)
          if(index===4)throw Error('one photo unavailable')
          return {
            url:'/media/test-'+(index+1),
            bytes:1000,
            label:{title:'Brinco '+(index+1),price:index+1,pack:'1 peça'},
          }
        }finally{active--}
      },
      onBatch:async rows=>staged.push(...rows),
      onProgress:async event=>progress.push(event),
      collectInMemory:false,
    })
    assert.equal(result.candidateCount,7)
    assert.equal(result.skipped,1)
    assert.deepEqual(staged.map(x=>x.external_id),[1,2,3,4,6,7,8].map(n=>'foto-'+String(n).padStart(4,'0')))
    assert.deepEqual(staged.map(x=>x.price),[1,2,3,4,6,7,8])
    assert.deepEqual(staged.map(x=>x.images[0]),[1,2,3,4,6,7,8].map(n=>'/media/test-'+n))
    assert.ok(staged.every(x=>x.source_image_key.length===22),
      'photo source identity must stay attached to its original photo')
    assert.equal(progress.at(-1).progress,95)
    assert.ok(progress.every((x,i)=>i===0||x.progress>=progress[i-1].progress),
      'progress must not regress even with out-of-order completions')
    return {peak,elapsedMs:Date.now()-began}
  }finally{
    if(original===undefined)delete process.env.SHOPVAX_GOOGLE_PHOTOS_CONCURRENCY
    else process.env.SHOPVAX_GOOGLE_PHOTOS_CONCURRENCY=original
  }
}
const serial=await parallelRun(1)
const parallel=await parallelRun(2)
assert.equal(serial.peak,1)
assert.equal(parallel.peak,2)
console.log('[scanner albums] bounded parallelism benchmark, simulated network/OCR only:',JSON.stringify({serial,parallel}))
