// Integration smoke: real HTTPS bytes with the same downloader used by a WhatsApp import.
// The UAZAPI catalog response is simulated because production instance credentials
// never belong in CI. No products are published; images stay in a temporary folder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectWhatsAppCatalog } from './scanner-uazapi-catalog.mjs'
import { safeRequest } from './scanner-collector.mjs'
import { normalizeCandidate } from './scanner-normalizer.mjs'

const catalog = 'https://wa.me/c/5511961860913'
const validImage = 'https://raw.githubusercontent.com/github/explore/main/topics/javascript/javascript.png'
const missingImage = 'https://raw.githubusercontent.com/github/explore/main/topics/javascript/no-such-image-20261113.png'
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('retrieves a real HTTPS catalog photo, retries alternate URL, stores actual PNG and exposes /media in review', { timeout: 60000 }, async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'shopvax-whatsapp-image-'))
  const saved = new Map()
  const received = []
  const product = { id: '10001', name: 'Produto teste HTTP', price: '19990',
    media: { images: [{
      original_image_url: missingImage,
      request_image_url: validImage,
    }] } }
  try {
    const output = await collectWhatsAppCatalog(catalog, {
      env: {
        SHOPVAX_WHATSAPP_UAZAPI_URL: 'https://uazapi.example.com',
        SHOPVAX_WHATSAPP_UAZAPI_TOKEN: 'synthetic-token-not-for-production',
      },
      request: (url, options) => {
        if (url === 'https://uazapi.example.com/business/catalog/list') {
          return Promise.resolve({
            ok: true, status: 200,
            body: JSON.stringify({ response: { products: [product] } }),
          })
        }
        return safeRequest(url, options)
      },
      onImage: async (bytes, mime, filename) => {
        assert.equal(mime, 'image/png')
        assert.ok(Buffer.isBuffer(bytes))
        assert.ok(bytes.subarray(0, 8).equals(pngMagic), 'PNG magic bytes missing')
        const assetId = 'image-' + (saved.size + 1)
        await writeFile(path.join(tempDir, filename), bytes)
        saved.set('/media/' + assetId, { filename, bytes: bytes.length })
        return '/media/' + assetId
      },
      onBatch: async (batch) => received.push(...batch),
      onProgress: async () => {},
      collectInMemory: false,
    })
    assert.equal(output.candidateCount, 1)
    assert.equal(saved.size, 1, 'the real HTTPS image must reach the storage callback')
    assert.equal(received.length, 1)
    assert.deepEqual(received[0].images, ['/media/image-1'])
    const stored = saved.get(received[0].images[0])
    const persisted = await readFile(path.join(tempDir, stored.filename))
    assert.ok(persisted.subarray(0, 8).equals(pngMagic))
    assert.equal(persisted.length, stored.bytes)
    assert.ok(persisted.length > 500)
    const normalized = normalizeCandidate(received[0])
    assert.equal(normalized.normalized.images[0], '/media/image-1')
    assert.equal(normalized.normalized.media_url, '/media/image-1')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
