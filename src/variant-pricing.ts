import type { VariantPrices, VariationGroup } from './types'
type Priced = { price: number; variantPrices?: VariantPrices | null }
export function variantUnitPrice(product: Priced, selections: Record<string, string>): number {
  const config = product.variantPrices
  const selected = config && selections[config.group]
  return config && selected && Object.hasOwn(config.prices, selected) ? config.prices[selected] : product.price
}
export function priceLabel(product: Priced, variations: VariationGroup[], currency: Intl.NumberFormat, selections: Record<string,string> = {}) {
  const config = product.variantPrices
  if (!config || selections[config.group]) return currency.format(variantUnitPrice(product, selections))
  const options = variations.find(g => g.name === config.group)?.options || []
  const prices = options.map(option => variantUnitPrice(product, { [config.group]: option }))
  return prices.length && Math.min(...prices) !== Math.max(...prices) ? 'A partir de ' + currency.format(Math.min(...prices)) : currency.format(prices[0] ?? product.price)
}
