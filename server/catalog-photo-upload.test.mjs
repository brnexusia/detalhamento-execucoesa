import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { acceptsCatalogMediaFile, detectCatalogImageType, prepareCatalogMedia, MAX_CATALOG_UPLOAD_BYTES } from './catalog-photo-upload.mjs'

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

test('AUDITORIA: upload de bytes arbitrários declarados como vídeo é aceito pelo código atual', async () => {
  const fakeVideo = Buffer.from('<html>nao e um video</html>')
  const result = await prepareCatalogMedia({
    buffer: fakeVideo, mimetype: 'video/mp4', originalname: 'falso.mp4',
  })
  // Documenta o comportamento vulnerável observado, sem executar upload de rede.
  assert.equal(result.type, 'video')
  assert.equal(result.mimeType, 'video/mp4')
  assert.deepEqual(result.buffer, fakeVideo)
  console.log('[AUDITORIA] upload MP4 falso aceito localmente:', result.type)
})
