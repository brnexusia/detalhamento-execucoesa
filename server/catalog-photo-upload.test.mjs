import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { acceptsCatalogMediaFile, detectCatalogImageType, detectCatalogVideoType, prepareCatalogMedia, MAX_CATALOG_UPLOAD_BYTES } from './catalog-photo-upload.mjs'

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y1lI7sAAAAASUVORK5CYII=', 'base64')

test('permite JPEG/PNG sem MIME definido e formatos da câmera, mas não SVG', () => {
  assert(acceptsCatalogMediaFile({ mimetype:'application/octet-stream', originalname:'IMG_0001.HEIC' }))
  assert(acceptsCatalogMediaFile({ mimetype:'image/jpeg', originalname:'foto.jpg' }))
  assert.equal(acceptsCatalogMediaFile({ mimetype:'image/svg+xml', originalname:'vetor.svg' }), false)
  assert.equal(acceptsCatalogMediaFile({ mimetype:'text/html', originalname:'arquivo.html' }), false)
})

test('detecta imagem pela assinatura e preserva originais pequenos', async () => {
  assert.equal(detectCatalogImageType(tinyPng), 'image/png')
  const result = await prepareCatalogMedia({ buffer:tinyPng, mimetype:'application/octet-stream', originalname:'foto.jpg' })
  assert.equal(result.type, 'image')
  assert.equal(result.mimeType, 'image/png')
  assert.deepEqual(result.buffer, tinyPng)
})

test('rejeita arquivos vazios, enganosos e SVG, sem salvar', async () => {
  await assert.rejects(prepareCatalogMedia({ buffer:Buffer.from('<svg/>'),mimetype:'image/jpeg',originalname:'foto.jpg' }), error => error.statusCode === 415)
  await assert.rejects(prepareCatalogMedia({ buffer:Buffer.alloc(0),mimetype:'image/png',originalname:'foto.png' }), error => error.statusCode === 400)
  await assert.rejects(prepareCatalogMedia({ buffer:Buffer.alloc(MAX_CATALOG_UPLOAD_BYTES + 1),mimetype:'image/png',originalname:'huge.png' }), error => error.statusCode === 413)
})

test('reduz fotos grandes mantendo imagem legível', async () => {
  const input = await sharp({create:{width:1600,height:1200,channels:3,background:'#cc66aa'}}).png({compressionLevel:0}).toBuffer()
  assert(input.length > 2 * 1024 * 1024)
  const output = await prepareCatalogMedia({buffer:input,mimetype:'image/png',originalname:'camera.png'})
  assert.equal(output.type,'image')
  assert.equal(output.mimeType,'image/webp')
  assert(output.buffer.length < input.length)
  const meta = await sharp(output.buffer).metadata()
  assert.equal(meta.width,1600)
  assert.equal(meta.height,1200)
})

test('converte AVIF de câmera para JPEG exibível no catálogo', async () => {
  const input = await sharp({create:{width:20,height:12,channels:3,background:'#cc66aa'}}).avif({effort:0}).toBuffer()
  const output = await prepareCatalogMedia({buffer:input,mimetype:'image/avif',originalname:'camera.avif'})
  assert.equal(output.mimeType,'image/jpeg')
  assert((await sharp(output.buffer).metadata()).format === 'jpeg')
})

test('bloqueia arquivos falsos disfarçados de MP4, MOV e WEBM', async () => {
  for (const name of ['payload.mp4', 'payload.mov', 'payload.webm']) {
    for (const buffer of [Buffer.from('<html><script>malicioso</script></html>'), Buffer.from('PK\\x03\\x04ZIP FILE')]) {
      await assert.rejects(
        prepareCatalogMedia({ buffer, mimetype: 'video/mp4', originalname: name }),
        error => error.statusCode === 415,
      )
    }
  }
  assert.equal(detectCatalogVideoType(Buffer.from('not actually a video')), null)
})

test('identifica assinaturas de contêineres de vídeo e preserva o MIME real', async () => {
  const mp4 = Buffer.alloc(24)
  mp4.writeUInt32BE(24, 0)
  mp4.write('ftypisom', 4, 'ascii')
  const mov = Buffer.from(mp4)
  mov.write('qt  ', 8, 'ascii')
  const webm = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]),
    Buffer.from('webm', 'ascii'), Buffer.alloc(20),
  ])
  for (const [bytes, expected, name] of [
    [mp4, 'video/mp4', 'clip.mp4'],
    [mov, 'video/quicktime', 'camera.mov'],
    [webm, 'video/webm', 'clip.webm'],
  ]) {
    const result = await prepareCatalogMedia({ buffer: bytes, mimetype: 'application/octet-stream', originalname: name })
    assert.equal(result.type, 'video')
    assert.equal(result.mimeType, expected)
    assert.deepEqual(result.buffer, bytes)
  }
  const disguised = await prepareCatalogMedia({ buffer: webm, mimetype: 'video/mp4', originalname: 'video.mp4' })
  assert.equal(disguised.mimeType, 'video/webm')
})
