// Optional internal PaddleOCR service for pages that require raster OCR.
// Never send catalog images to public endpoints by default.
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 500_000

export function isPaddleOcrSelected(env = process.env) {
  return String(env.PDF_OCR_ENGINE || '').trim().toLowerCase() === 'paddle'
}

export async function paddleOcrImage(image, options = {}) {
  const env = options.env || process.env
  const base = String(env.PDF_OCR_SERVICE_URL || '').trim()
  const secret = String(env.PDF_OCR_SHARED_SECRET || '').trim()
  if (!base || secret.length < 16) throw new Error('PaddleOCR: serviço interno ou segredo não configurado.')
  const endpoint = new URL(base)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('PaddleOCR: endereço interno inválido.')
  }
  if (!Buffer.isBuffer(image) || image.length < 8 || image.length > MAX_INPUT_BYTES ||
      !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error('PaddleOCR: imagem PNG inválida ou muito grande.')
  }
  const remaining = Number.isFinite(options.deadline) ? options.deadline - Date.now() : 30_000
  if (remaining <= 0) throw new Error('PaddleOCR: prazo de importação esgotado.')
  const timeout = Math.max(1, Math.min(30_000, remaining))
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + '/ocr'
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const response = await fetchImpl(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-PDF-OCR-Token': secret,
    },
    body: image,
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) throw new Error('PaddleOCR: serviço retornou HTTP ' + response.status)
  const result = await response.json()
  const extracted = String(result?.text || '').trim()
  if (Buffer.byteLength(extracted, 'utf8') > MAX_TEXT_BYTES) throw new Error('PaddleOCR: resposta excessiva.')
  return extracted
}
