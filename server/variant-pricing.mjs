export function normalizeVariantPrices(value, variations) {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Preços por variação inválidos.')
  const group = (Array.isArray(variations) ? variations : []).find(g => g.name === value.group)
  if (!group || !value.prices || typeof value.prices !== 'object' || Array.isArray(value.prices)) throw Error('Escolha uma variação válida para os preços.')
  const entries = Object.entries(value.prices)
  if (entries.some(([option, price]) => !group.options.includes(option) || typeof price !== 'number' || !Number.isFinite(price) || price < .01 || price > 9999999999.99)) throw Error('Informe preços positivos para opções válidas.')
  return entries.length ? { group: group.name, prices: Object.fromEntries(entries.map(([option, price]) => [option, Math.round(price * 100) / 100])) } : null
}
// Prices are absolute in the base catalog; other catalog prices retain their relative pricing.
export function resolvedVariantPrices(product, catalogPrice = product.public_price ?? product.price) {
  let config
  try { config = normalizeVariantPrices(product.variant_prices, product.variations) } catch { return null }
  if (!config) return null
  const base = Number(product.price)
  const effective = Number(catalogPrice)
  if (!(base > 0 && effective > 0)) return null
  return { group: config.group, prices: Object.fromEntries(Object.entries(config.prices).map(([option, price]) => [option, Math.max(.01, Math.round(price / base * effective * 100) / 100)])) }
}
export function variantUnitPrice(product, selections, catalogPrice = product.public_price ?? product.price) {
  const config = resolvedVariantPrices(product, catalogPrice)
  const selected = config && selections?.[config.group]
  return selected && Object.hasOwn(config.prices, selected) ? config.prices[selected] : Number(catalogPrice)
}
