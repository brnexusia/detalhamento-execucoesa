// Liberação temporária de novos cadastros sem cobrança.
// A exigência de assinatura só é ativada explicitamente pelo operador.
// Lojas existentes mantêm seu próprio billing_required.
export function requiresPaymentForSignup(env = process.env) {
  return String(env.SHOPVAX_REQUIRE_PAYMENT_ON_SIGNUP || '').trim() === '1'
}
