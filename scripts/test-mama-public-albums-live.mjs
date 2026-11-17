import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { links } from './mama-public-album-links.mjs'
import { safeRequest } from '../server/scanner-collector.mjs'
import { googlePhotosImageUrls, googlePhotosHighResolutionUrl } from '../server/scanner-photo-albums.mjs'
import { recognizePhotoProductLabel } from '../server/scanner-photo-ocr.mjs'

// Read-only live verification: never writes to the ShopVax product database.
const results = new Array(links.length)
let cursor = 0
async function worker() {
  while (cursor < links.length) {
    const index = cursor++
    const [album, source] = links[index]
    const row = { album, source, accessible: false, photoCount: 0, sampleDownloaded: false, sampleOcr: null, error: null }
    try {
      const page = await safeRequest(source, {
        accept: 'text/html,application/xhtml+xml', maxBytes: 24 * 1024 * 1024, timeout: 25000,
      })
      assert.ok(page.ok, 'album request failed')
      assert.equal(new URL(page.url || source).hostname, 'photos.google.com')
      const photos = googlePhotosImageUrls(page.body, 10000)
      row.photoCount = photos.length
      assert.ok(photos.length > 0, 'album exposes no public photos')
      row.accessible = true
      const imageUrl = googlePhotosHighResolutionUrl(photos[0]) || photos[0]
      const photo = await safeRequest(imageUrl, {
        responseType: 'buffer', accept: 'image/*', maxBytes: 8 * 1024 * 1024, timeout: 25000,
      })
      assert.ok(photo.ok && Buffer.isBuffer(photo.buffer), 'sample photo download failed')
      row.sampleDownloaded = true
      const label = await recognizePhotoProductLabel(photo.buffer)
      row.sampleOcr = label ? {
        title: label.title || null, price: label.price ?? null, pack: label.pack || null,
        sku: label.sku || null,
      } : null
    } catch (error) {
      row.error = String(error?.message || error).slice(0, 300)
    }
    results[index] = row
    console.log('MAMA_LIVE_ALBUM ' + JSON.stringify(row))
  }
}
await Promise.all(Array.from({ length: 3 }, () => worker()))
await mkdir('reports', { recursive: true })
await writeFile('reports/mama-google-photos-live-smoke.json',
  JSON.stringify({date:new Date().toISOString(), total:links.length, results}, null, 2))
const failed = results.filter(row => !row.accessible || !row.sampleDownloaded)
console.log('MAMA_LIVE_SUMMARY ' + JSON.stringify({
  albums:results.length, accessible:results.filter(x=>x.accessible).length,
  samplesDownloaded:results.filter(x=>x.sampleDownloaded).length,
  samplesWithPrice:results.filter(x=>x.sampleOcr?.price != null).length,
  failures:failed.map(x=>x.album),
}))
assert.equal(failed.length, 0, 'one or more shared albums or sample images were inaccessible')
