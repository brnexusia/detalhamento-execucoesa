import test from 'node:test'
import assert from 'node:assert/strict'
import { isPaddleOcrSelected, paddleOcrImage, paddleOcrLayout } from './scanner-pdf-paddle.mjs'

const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4])

test('PaddleOCR is enabled by default inside the app container', () => {
  assert.equal(isPaddleOcrSelected({}), true)
  assert.equal(isPaddleOcrSelected({ PDF_OCR_ENGINE: 'paddle' }), true)
  assert.equal(isPaddleOcrSelected({ PDF_OCR_ENGINE: 'tesseract' }), false)
})

test('sends PNG to loopback only; no EasyPanel hostname or token', async () => {
  let called = false
  const text = await paddleOcrImage(png, { env: {
    PDF_OCR_SERVICE_URL: 'https://external.example.invalid/ocr',
    PDF_OCR_SHARED_SECRET: 'ignored-legacy-token',
  }, fetchImpl: async (url, opts) => {
    called = true
    assert.equal(url, 'http://127.0.0.1:8088/ocr')
    assert.equal(opts.method, 'POST')
    assert.deepEqual(opts.headers, { 'Content-Type': 'image/png' })
    assert.equal(opts.body, png)
    return new Response(JSON.stringify({ text: 'Blusa Aurora\nR$ 40,00' }), { status: 200 })
  } })
  assert.equal(called, true)
  assert.equal(text, 'Blusa Aurora\nR$ 40,00')
})

test('supports a private loopback port override', async () => {
  await paddleOcrImage(png, { env: { PDF_OCR_PORT: '9090' }, fetchImpl: async (url) => {
    assert.equal(url, 'http://127.0.0.1:9090/ocr')
    return new Response(JSON.stringify({ text: '' }))
  } })
})

test('rejects invalid PNG and invalid internal port', async () => {
  await assert.rejects(paddleOcrImage(Buffer.from('not-png'), {}), /PNG/)
  await assert.rejects(paddleOcrImage(png, { env: { PDF_OCR_PORT: '99999' } }), /porta/)
})

test('reports local Paddle failure for Tesseract fallback', async () => {
  await assert.rejects(paddleOcrImage(png, {
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  }), /HTTP 503/)
})

test('rejects excessive text responses', async () => {
  await assert.rejects(paddleOcrImage(png, {
    fetchImpl: async () => new Response(JSON.stringify({ text: 'A'.repeat(500001) })),
  }), /excessiva/)
})

test('retains PaddleOCR coordinates for spatial product matching', async () => {
  const lines = [
    { text: 'Vestido Solar', score: 0.98, box: [30, 80, 210, 110] },
    { text: 'R$ 29,90', score: 0.99, box: [35, 145, 165, 173] },
  ]
  const result = await paddleOcrLayout(png, {
    fetchImpl: async () => new Response(JSON.stringify({
      text: 'Vestido Solar\nR$ 29,90',
      lines,
    })),
  })
  assert.deepEqual(result.lines, lines)
  assert.match(result.text, /Vestido Solar/)
})
