import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { generateMediaVariants, requestedMediaWidth } from './media-variants.mjs'

test('uploads fotográficos geram variantes WebP menores preservando original', async () => {
  const original = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: { r: 160, g: 110, b: 90 } },
  }).png().toBuffer()
  const copy = Buffer.from(original)
  const variants = await generateMediaVariants(original, 'image/png')
  assert.deepEqual(variants.map(x => x.width), [320, 960])
  for (const item of variants) {
    assert.equal(item.mimeType, 'image/webp')
    assert(item.bytes.length < original.length, 'Não deve gerar variante maior que o original')
    const meta = await sharp(item.bytes).metadata()
    assert(meta.width <= item.width)
    assert.equal(meta.format, 'webp')
  }
  assert.deepEqual(original, copy, 'Original não pode ser transformado')
})

test('não converte vídeo, GIF animado, SVG ou entrada inválida', async () => {
  for (const mime of ['video/mp4', 'image/gif', 'image/svg+xml', 'image/avif', 'application/pdf']) {
    assert.deepEqual(await generateMediaVariants(Buffer.from('not-an-image'), mime), [])
  }
  assert.equal(requestedMediaWidth('320'), 320)
  assert.equal(requestedMediaWidth('960'), 960)
  for (const value of [320, 960, '0', '500', '2000', 'abc', undefined, null]) {
    assert.equal(requestedMediaWidth(value), null)
  }
})

test('não aumenta fotos pequenas e respeita a orientação', async () => {
  const image = await sharp({ create: { width: 240, height: 180, channels: 3, background: 'white' } }).jpeg().toBuffer()
  assert.deepEqual(await generateMediaVariants(image, 'image/jpeg'), [])
})
