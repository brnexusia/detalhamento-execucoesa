// Cobrança obrigatória para todas as NOVAS lojas em produção.
// O cadastro técnico é criado como pendente para emitir Checkout Stripe;
// não há acesso ao painel até invoice.paid validada pelo webhook.
// Lojas antigas preservam a coluna billing_required sem migração automática.
export function requiresPaymentForSignup(env = process.env) {
  // O desvio abaixo existe somente para suites de integração locais.
  // SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP=0 nunca libera cadastro gratuito em produção.
  if (String(env.NODE_ENV || '').trim() === 'test') {
    return String(env.SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP || '').trim() === '1'
  }
  return true
}
