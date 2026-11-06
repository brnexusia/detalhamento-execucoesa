// Black Friday 2026. O preço vigente continua pertencendo ao cadastro do plano no banco.
// O selo promocional aparece somente enquanto o valor do painel coincidir com a oferta.
export const blackFridayPrices = Object.freeze({
  bronze: Object.freeze({ monthlyPrice: 29.99, originalMonthlyPrice: 49.90 }),
  prata: Object.freeze({ monthlyPrice: 49.99, originalMonthlyPrice: 94.90 }),
  ouro: Object.freeze({ monthlyPrice: 69.99, originalMonthlyPrice: 144.90 }),
})

export function blackFridayPromotion(code, monthlyPrice) {
  const entry = blackFridayPrices[String(code || '').toLowerCase()]
  const amount = Number(monthlyPrice)
  if (!entry || !Number.isFinite(amount) || Math.round(amount * 100) !== Math.round(entry.monthlyPrice * 100)) return null
  return { label: 'Black Friday', originalMonthlyPrice: entry.originalMonthlyPrice }
}
