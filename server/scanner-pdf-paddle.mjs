// Local PaddleOCR sidecar process inside the SAME Atacado Shop container.
// The HTTP server listens on loopback only; there is no public URL, token or extra EasyPanel service.
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 500_000
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function isPaddleOcrSelected(env = process.env) {
  return String(env.PDF_OCR_ENGINE ?? 'paddle').trim().toLowerCase() === 'paddle'
}

export async function paddleOcrImage(image, options = {}) {
  const env = options.env || process.env
  if (!Buffer.isBuffer(image) || image.length < 8 || image.length > MAX_INPUT_BYTES ||
      !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PaddleOCR: imagem PNG inválida ou muito grande.')
  }
  const port = Number(env.PDF_OCR_PORT || 8088)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error('PaddleOCR: porta interna inválida.')
  const remaining = Number.isFinite(options.deadline) ? options.deadline - Date.now() : 30_000
  if (remaining <= 0) throw new Error('PaddleOCR: prazo de importação esgotado.')
  const timeout = Math.max(1, Math.min(30_000, remaining))
  // Never use configurable outbound URLs: PDF bytes remain inside this container.
  const url = 'http://127.0.0.1:' + port + '/ocr'
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: image,
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) throw new Error('PaddleOCR: motor local retornou HTTP ' + response.status)
  const result = await response.json()
  const extracted = String(result?.text || '').trim()
  if (Buffer.byteLength(extracted, 'utf8') > MAX_TEXT_BYTES) throw new Error('PaddleOCR: resposta excessiva.')
  return extracted
}
