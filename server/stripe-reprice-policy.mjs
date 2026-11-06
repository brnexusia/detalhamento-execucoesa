// Pure validation: no Stripe writes should be possible unless the
// subscription belongs to the selected Shopvax store and cycle.
export function validateStripeRepricingTarget(subscription, row, target) {
  const items = subscription?.items?.data
  const first = items?.[0]
  const currentPrice = first?.price
  const customer = typeof subscription?.customer === 'string'
    ? subscription.customer : subscription?.customer?.id
  const expectedInterval = target?.interval
  const expectedCount = target?.intervalCount
  if (!subscription || !row || !target || !first?.id ||
      subscription.id !== row.subscription_id ||
      subscription.metadata?.shopvax_store_id !== row.store_id ||
      customer !== row.customer_id || subscription.status !== 'active' ||
      subscription.cancel_at_period_end || subscription.pending_update ||
      !Array.isArray(items) || items.length !== 1 ||
      typeof currentPrice !== 'object' || currentPrice?.currency !== 'brl' ||
      !Number.isSafeInteger(currentPrice.unit_amount) || currentPrice.unit_amount < 0 ||
      currentPrice.recurring?.interval !== expectedInterval ||
      Number(currentPrice.recurring?.interval_count) !== Number(expectedCount) ||
      !Number.isSafeInteger(target.amountCents) || target.amountCents <= 0) {
    return { ok:false, reason:'A assinatura, loja ou ciclo não corresponde ao registro confirmado.' }
  }
  return { ok:true, currentAmountCents:Number(currentPrice.unit_amount), itemId:first.id }
}

export function nextInvoiceRepriceFields(itemId, priceId) {
  if (!/^si_[a-zA-Z0-9]+$/.test(String(itemId)) || !/^price_[a-zA-Z0-9]+$/.test(String(priceId)))
    throw new Error('IDs da assinatura ou do preço inválidos.')
  return {
    'items[0][id]':itemId,
    'items[0][price]':priceId,
    proration_behavior:'none',
  }
}
