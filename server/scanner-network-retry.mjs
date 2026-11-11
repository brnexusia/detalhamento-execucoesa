/**
 * Resilient, bounded retries for read-only catalog scanning requests.
 * This wrapper is only used by scanner collectors, not checkout endpoints.
 * Network failures should retry the individual page, never restart a 3k-item scan.
 */
const transientCodes = new Set([
  'ECONNRESET','ETIMEDOUT','EPIPE','EAI_AGAIN','ECONNREFUSED',
  'ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','ERR_STREAM_PREMATURE_CLOSE',
])
const transientStatuses = new Set([408,425,429,500,502,503,504])
const transientText = /\bECONNRESET\b|socket hang up|connection reset|read ECONNRESET|premature close|resposta interrompida|socket disconnected|tempo(?:u|ut) esgotado|demorou demais para responder|aborted/i

export function isTransientScannerNetworkError(error) {
  let current = error
  for (let i = 0; i < 4 && current; i++) {
    const code = String(current.code || '').toUpperCase()
    if (transientCodes.has(code)) return true
    if (transientText.test(String(current.message || ''))) return true
    current = current.cause
  }
  return false
}

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function waitMs(attempt, response) {
  const retryAfter = response?.headers?.['retry-after']
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(10000, seconds * 1000)
  return Math.min(5000, 350 * 2 ** attempt)
}

export function retryScannerRequest(request, {
  maxAttempts = 5,
  sleep = defaultSleep,
  onRetry = () => {},
} = {}) {
  if (typeof request !== 'function') throw new TypeError('Scanner request function required')
  const cap = Math.max(1, Math.min(8, Math.floor(Number(maxAttempts) || 5)))
  return async (url, options = {}) => {
    for (let attempt = 0; attempt < cap; attempt++) {
      try {
        const response = await request(url, options)
        if (!transientStatuses.has(Number(response?.status)) || attempt === cap - 1) return response
        onRetry({ attempt: attempt + 1, status: Number(response.status), url: String(url) })
        await sleep(waitMs(attempt, response))
      } catch (error) {
        if (!isTransientScannerNetworkError(error) || attempt === cap - 1) throw error
        onRetry({ attempt: attempt + 1, code: String(error.code || error.cause?.code || 'NETWORK'), url: String(url) })
        await sleep(waitMs(attempt))
      }
    }
  }
}
