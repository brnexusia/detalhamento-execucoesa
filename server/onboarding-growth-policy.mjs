export const ONBOARDING_CONFIRMABLE = new Set(['minimum_reviewed', 'preview_opened', 'whatsapp_understood'])
export const CONSENT_CHANNELS = ['whatsapp', 'email']

export function normalizePreferences(body, allowedIds) {
  if (!body || typeof body.whatsapp !== 'boolean' || typeof body.email !== 'boolean') {
    throw new Error('Escolha separadamente receber ofertas por WhatsApp e por e-mail.')
  }
  if (body.scope !== 'selected' && body.scope !== 'all_current') throw new Error('Escolha as lojas autorizadas.')
  if (!Array.isArray(body.storeIds) || body.storeIds.length > 100 || body.storeIds.some(id => typeof id !== 'string')) {
    throw new Error('Seleção de lojas inválida.')
  }
  const input = [...new Set(body.storeIds)]
  if (input.some(id => !allowedIds.includes(id))) throw new Error('Há lojas indisponíveis na seleção.')
  const storeIds = body.scope === 'all_current' ? allowedIds.slice() : input
  if ((body.whatsapp || body.email) && storeIds.length === 0) {
    throw new Error('Selecione ao menos uma loja para receber ofertas.')
  }
  return { whatsapp: body.whatsapp, email: body.email, scope: body.scope, storeIds }
}

export function shouldShowAcquisition({ authenticated, closedAt, now = Date.now(), cooldownDays = 7 }) {
  return !authenticated && (!Number.isFinite(closedAt) || closedAt <= 0 || now - closedAt >= cooldownDays * 86400000)
}

export function validateSupportInput(body) {
  const audience = body?.audience
  const topic = body?.topic
  const message = String(body?.message || '').trim()
  const replyEmail = String(body?.replyEmail || '').trim().toLowerCase()
  if (!['buyer', 'merchant'].includes(audience)) throw new Error('Tipo de atendimento inválido.')
  if (!['account', 'catalog', 'order', 'billing', 'privacy', 'other'].includes(topic)) throw new Error('Escolha um assunto de atendimento.')
  if (message.length < 15 || message.length > 2000) throw new Error('Descreva a situação entre 15 e 2.000 caracteres.')
  if (audience === 'buyer' && !replyEmail) throw new Error('Informe um e-mail para retorno humano.')
  if (replyEmail.length > 200 || (replyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail))) throw new Error('E-mail de retorno inválido.')
  if (body?.privacyAcknowledged !== true) throw new Error('Confirme que entende como o relato será armazenado.')
  return { audience, topic, message, replyEmail }
}


/** Assistência pública só responde perguntas gerais sem enviar dados identificáveis à IA. */
export function validateSupportQuestion(body) {
  const audience = body?.audience
  const topic = body?.topic
  const question = String(body?.question || '').replace(/\s+/g, ' ').trim()
  if (!['buyer','merchant'].includes(audience)) throw new Error('Público de suporte inválido.')
  if (!['account','catalog','order','billing','privacy','other'].includes(topic)) throw new Error('Assunto de suporte inválido.')
  if (question.length < 8 || question.length > 600) throw new Error('Digite uma dúvida entre 8 e 600 caracteres.')
  // Também rejeita CPF/CNPJ/telefone formatados: +55 (11) 99999-9999 e
  // 123.456.789-09 jamais devem escapar por não terem dígitos contíguos.
  // Não inspecionamos nem transmitimos identificação da conta do visitante.
  const digitRuns = question.match(/\+?\d[\d\s().-]{7,}\d/g) || []
  const hasLongIdentifier = digitRuns.some(chunk => chunk.replace(/\D/g, '').length >= 9)
  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(question)
  const hasUrl = /\b(?:https?:\/\/|www\.)\S+/i.test(question)
  if (hasEmail || hasLongIdentifier || hasUrl) {
    throw new Error('Não envie e-mail, telefone, CPF, link privado, número de pedido ou outros dados pessoais à IA.')
  }
  if (body?.privacyAcknowledged !== true) throw new Error('Confirme que deseja enviar a dúvida sem dados pessoais à assistência por IA.')
  return { audience, topic, question }
}
