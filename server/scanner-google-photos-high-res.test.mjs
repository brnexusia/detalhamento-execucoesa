import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  googlePhotosHighResolutionUrl, collectSharedPhotos,
} from './scanner-photo-albums.mjs'

const album = 'https://photos.app.goo.gl/sample-public'
const googlePhoto = 'https://lh3.googleusercontent.com/pw/'+'A'.repeat(90)+'=w54-h72-no'
const photoTwo = 'https://lh3.googleusercontent.com/pw/'+'B'.repeat(90)+'=w54-h72-no'

test('rewrites only Google image CDN resolution suffix, without touching a foreign host', () => {
  assert.equal(googlePhotosHighResolutionUrl(googlePhoto),
    googlePhoto.replace('=w54-h72-no','=w1600-h1600'))
  assert.equal(googlePhotosHighResolutionUrl('https://example.com/pw/x=w54-h72-no'), '')
  assert.equal(googlePhotosHighResolutionUrl('http://lh3.googleusercontent.com/pw/x=w54-h72-no'), '')
  assert.equal(googlePhotosHighResolutionUrl('https://lh3.googleusercontent.com/pw/x=s2000'), '')
  assert.equal(googlePhotosHighResolutionUrl('https://lh3.googleusercontent.com/pw/x'), '')
})

test('Google Photos imports full-size bytes for tiny 54x72 thumbnail links', async () => {
  const large = await sharp({create:{width:1086,height:1448,channels:3,background:'#993322'}}).jpeg().toBuffer()
  const tiny = await sharp({create:{width:54,height:72,channels:3,background:'#993322'}}).png().toBuffer()
  const requests = [], persisted = [], staged = []
  const html = '<script>'+[googlePhoto,photoTwo].map(x=>'"'+x+'"').join(',')+'</script>'
  const result=await collectSharedPhotos(album, {
    maxProducts:2,collectInMemory:false,
    onProgress:async()=>{},
    request:async (url,options)=>{
      requests.push(url)
      if (url === album) return {ok:true,url:'https://photos.google.com/share/sample-public',
        contentType:'text/html',body:html}
      assert.equal(options.responseType,'buffer')
      return {ok:true,buffer:url.includes('=w1600-h1600')?large:tiny}
    },
    onImage:async(bytes,type)=>{
      assert.equal(type,'image/webp')
      const meta=await sharp(bytes).metadata()
      assert.equal(meta.format,'webp')
      assert.ok(meta.width>=220 && meta.height>=220)
      const saved='/media/photo-'+(persisted.length+1)
      persisted.push(saved)
      return saved
    },
    onBatch:async rows=>staged.push(...rows),
  })
  assert.equal(result.candidateCount,2)
  assert.equal(result.skipped,0)
  assert.equal(staged.length,2)
  assert.deepEqual(staged.flatMap(p=>p.images),persisted)
  assert.equal(requests.length,3)
  assert.ok(requests.slice(1).every(u=>u.endsWith('=w1600-h1600')))
})

test('falls back to original Google Photos URL when high-resolution variant is denied', async () => {
  const medium = await sharp({create:{width:600,height:750,channels:3,background:'#664422'}}).jpeg().toBuffer()
  const thumb=googlePhoto.replace('=w54-h72-no','=w600-h750-no')
  const requests=[]
  const result=await collectSharedPhotos(album, {
    maxProducts:1,
    request:async (url)=>{
      requests.push(url)
      if(url===album)return {ok:true,url:'https://photos.google.com/share/sample-public',
        contentType:'text/html',body:'<script>"'+thumb+'"</script>'}
      if(url.endsWith('=w1600-h1600'))return {ok:false,status:403}
      return {ok:true,buffer:medium}
    },
    onImage:async()=>'/media/fallback-image',
    onProgress:async()=>{},
  })
  assert.equal(result.candidateCount,1)
  assert.equal(result.skipped,0)
  assert.deepEqual(result.candidates[0].images,['/media/fallback-image'])
  assert.equal(requests.length,3)
  assert.equal(requests[2],thumb)
})


test('requests full-size versions when Google Photos provides a bare image CDN URL',async()=>{
  const bare=googlePhoto.replace('=w54-h72-no','')
  assert.equal(googlePhotosHighResolutionUrl(bare),bare+'=w1600-h1600')
  assert.equal(googlePhotosHighResolutionUrl(bare+'?foo=bar'),bare+'=w1600-h1600?foo=bar')
  assert.equal(googlePhotosHighResolutionUrl('https://lh3.googleusercontent.com/pw/x'),'')

  const large=await sharp({create:{width:1086,height:1448,channels:3,
    background:'#4499aa'}}).jpeg().toBuffer()
  const preview=await sharp({create:{width:384,height:512,channels:3,
    background:'#4499aa'}}).jpeg().toBuffer()
  const requested=[],sizes=[]
  const result=await collectSharedPhotos(album,{
    maxProducts:1,collectInMemory:false,
    request:async(url)=>{
      requested.push(url)
      if(url===album)return {ok:true,url:'https://photos.google.com/share/sample-public',
        contentType:'text/html',body:'<script>"'+bare+'"</script>'}
      return {ok:true,buffer:url.endsWith('=w1600-h1600')?large:preview}
    },
    onImage:async(bytes)=>{
      const m=await sharp(bytes).metadata()
      sizes.push([m.width,m.height])
      return '/media/photo-large'
    },
    onProgress:async()=>{},
  })
  assert.equal(result.candidateCount,1)
  assert.equal(requested.length,2)
  assert.equal(requested[1],bare+'=w1600-h1600')
  assert.ok(sizes[0][0]>384 && sizes[0][1]>512,
    'must store a high-resolution source instead of the 384x512 default preview')
})
