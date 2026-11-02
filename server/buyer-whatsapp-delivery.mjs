const brazilianWhatsapp = /^55\d{10,11}$/
const verificationCode = /^\d{6}$/
const trackingToken = /^[A-Za-z0-9_-]{8,120}$/

export const BUYER_WHATSAPP_DELIVERY_TIMEOUT_MS = 8000

export class BuyerWhatsappDeliveryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BuyerWhatsappDeliveryError'
    this.code = code
  }
}

export function buyerWhatsappDeliveryConfigured(env = process.env) {
  try {
    const url = new URL(String(env.UAZAPI_BASE_URL || '').trim())
    return url.protocol === 'https:' && Boolean(String(env.UAZAPI_INSTANCE_TOKEN || '').trim())
  } catch {
    return false
  }
}

export function buildBuyerVerificationMessage(code) {
  if (!verificationCode.test(String(code || ''))) {
    throw new BuyerWhatsappDeliveryError('INVALID_CODE', 'Código de verificação inválido.')
  }
  return `ShopVax: seu código de verificação é ${code}. Válido por 5 minutos. Não compartilhe.`
}

export async function deliverBuyerVerificationCode({
  phone,
  code,
  trackingId,
  baseUrl = process.env.UAZAPI_BASE_URL,
  token = process.env.UAZAPI_INSTANCE_TOKEN,
  fetchImpl = globalThis.fetch,
  timeoutMs = BUYER_WHATSAPP_DELIVERY_TIMEOUT_MS,
} = {}) {
  if (!brazilianWhatsapp.test(String(phone || ''))) {
    throw new BuyerWhatsappDeliveryError('INVALID_PHONE', 'WhatsApp de destino inválido.')
  }
  if (!trackingToken.test(String(trackingId || ''))) {
    throw new BuyerWhatsappDeliveryError('INVALID_TRACKING_ID', 'Identificador de envio inválido.')
  }
  if (typeof fetchImpl !== 'function') {
    throw new BuyerWhatsappDeliveryError('DELIVERY_UNAVAILABLE', 'Serviço de envio indisponível.')
  }

  let endpoint
  try {
    endpoint = new URL('/send/text', String(baseUrl || '').trim())
    if (endpoint.protocol !== 'https:' || !String(token || '').trim()) throw new Error('invalid config')
  } catch {
    throw new BuyerWhatsappDeliveryError('DELIVERY_NOT_CONFIGURED', 'Serviço de envio indisponível.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || BUYER_WHATSAPP_DELIVERY_TIMEOUT_MS))
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', token: String(token).trim() },
      body: JSON.stringify({
        number: phone,
        text: buildBuyerVerificationMessage(code),
        track_source: 'shopvax_auth',
        track_id: trackingId,
        async: false,
      }),
    })
    if (!response?.ok) {
      throw new BuyerWhatsappDeliveryError('PROVIDER_REJECTED', 'Serviço de envio indisponível.')
    }
    return { ok: true }
  } catch (error) {
    if (error instanceof BuyerWhatsappDeliveryError) throw error
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new BuyerWhatsappDeliveryError('DELIVERY_TIMEOUT', 'Serviço de envio indisponível.')
    }
    throw new BuyerWhatsappDeliveryError('DELIVERY_FAILED', 'Serviço de envio indisponível.')
  } finally {
    clearTimeout(timeout)
  }
}
