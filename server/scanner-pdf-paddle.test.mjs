import test from 'node:test'
import assert from 'node:assert/strict'
import { isPaddleOcrSelected, paddleOcrImage } from './scanner-pdf-paddle.mjs'

const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])
const env = {
  PDF_OCR_ENGINE: 'paddle',
  PDF_OCR_SERVICE_URL: 'http://paddle-ocr:8088',
  PDF_OCR_SHARED_SECRET: 'a-test-secret-longer-than-16',
}

test('PaddleOCR activates only by explicit engine selection', () => {
  assert.equal(isPaddleOcrSelected({}), false)
  assert.equal(isPaddleOcrSelected({ PDF_OCR_ENGINE: 'tesseract' }), false)
  assert.equal(isPaddleOcrSelected(env), true)
})

test('sends PNG only to configured authenticated service and reads the text', async () => {
  let called = false
  const text = await paddleOcrImage(png, { env, fetchImpl: async (url, opts) => {
    called = true
    assert.equal(url, 'http://paddle-ocr:8088/ocr')
    assert.equal(opts.method, 'POST')
    assert.equal(opts.headers['X-PDF-OCR-Token'], env.PDF_OCR_SHARED_SECRET)
    assert.equal(opts.body, png)
    return new Response(JSON.stringify({ text: 'Blusa Aurora\nR$ 40,00' }), { status: 200 })
  } })
  assert.equal(called, true)
  assert.equal(text, 'Blusa Aurora\nR$ 40,00')
})

test('rejects absent credentials and malformed input', async () => {
  await assert.rejects(paddleOcrImage(png, { env: { ...env, PDF_OCR_SHARED_SECRET: '' } }), /segredo/)
  await assert.rejects(paddleOcrImage(Buffer.from('not-png'), { env }), /PNG/)
})

test('surfaces service failures so the import pipeline can fall back to Tesseract', async () => {
  await assert.rejects(paddleOcrImage(png, {
    env,
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  }), /HTTP 503/)
})

test('rejects public URL credentials and invalid schemes', async () => {
  await assert.rejects(paddleOcrImage(png, {
    env: { ...env, PDF_OCR_SERVICE_URL: 'file:///tmp/model' },
  }), /endereço/)
})
