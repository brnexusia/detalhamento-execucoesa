import assert from 'node:assert/strict'
import sharp from 'sharp'
import { collectSharedPhotos, googlePhotosImageUrls, sharedPhotoSourceKind, MAX_ALBUM_ITEMS } from './scanner-photo-albums.mjs'

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
