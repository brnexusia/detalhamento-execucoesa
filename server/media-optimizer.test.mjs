import assert from 'node:assert/strict'
import sharp from 'sharp'
import { optimizeImageBuffer } from './media-optimizer.mjs'

const largeSource = await sharp({
  create: { width: 1200, height: 600, channels: 3, background: '#d9d2c3' },
}).jpeg({ quality: 90 }).toBuffer()

const large = await optimizeImageBuffer(largeSource)
const byName = Object.fromEntries(large.variants.map((variant) => [variant.name, variant]))
assert.equal(byName.thumb.width, 400)
assert.equal(byName.thumb.height, 200)
assert.equal(byName.medium.width, 900)
assert.equal(byName.medium.height, 450)
assert.equal(byName.large.width, 1200, 'large não pode ampliar além do original')
assert.equal(byName.large.height, 600)
for (const variant of large.variants) assert.equal(variant.mimeType, 'image/webp')

const tinySource = await sharp({
  create: { width: 100, height: 100, channels: 3, background: '#c7c0b3' },
}).png().toBuffer()

const tiny = await optimizeImageBuffer(tinySource)
for (const variant of tiny.variants) {
  assert.equal(variant.width, 100, `${variant.name} não deve ampliar imagem pequena`)
  assert.equal(variant.height, 100, `${variant.name} não deve ampliar imagem pequena`)
}

console.log('[media optimizer] variants keep aspect ratio and never upscale: ok')
