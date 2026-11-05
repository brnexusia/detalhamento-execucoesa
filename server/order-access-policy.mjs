// Guest checkout never grants permission to mutate an order or create a charge.
// A valid logged-in buyer must match the persisted owner of that order.
export function customerOwnsOrder(order, customer) {
  return Boolean(order?.customer_id && customer?.id && String(order.customer_id) === String(customer.id))
}

// Quotes are obtained from a client-supplied subtotal. Never let a quote for
// another amount unlock discounts/free shipping on the persisted order.
export function quoteMatchesOrder(quote, order) {
  const quoteSubtotal = Number(quote?.subtotal)
  const orderTotal = Number(order?.total)
  return Number.isFinite(quoteSubtotal) && Number.isFinite(orderTotal) &&
    quoteSubtotal >= 0 && orderTotal >= 0 &&
    Math.round(quoteSubtotal * 100) === Math.round(orderTotal * 100)
}
