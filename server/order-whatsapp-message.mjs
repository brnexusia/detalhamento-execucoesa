const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const text = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
const money = (value) => formatter.format(Number(value || 0))

// Use the image displayed for the chosen variation, otherwise the catalog gallery.
const publicOrigin = 'https://shopvax.com.br'
function publicImageUrl(value) {
  const raw = String(value || '').trim()
  if (!raw || /[\s\\]/.test(raw)) return ''
  const local = raw.startsWith(publicOrigin + '/') ? raw.slice(publicOrigin.length) : raw
  // Local media assets have immutable identifiers; don't accept protocol-relative paths.
  if (/^\/media\/[A-Za-z0-9_-]+(?:\?[^#]*)?$/.test(local)) return publicOrigin + local
  if (!/^https?:\/\//i.test(raw)) return ''
  try {
    const url = new URL(raw)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function orderProductDetails(product, selections = {}) {
  const groups = Array.isArray(product.variant_images) ? product.variant_images : []
  const matched = groups.filter(group => {
    const entries = Object.entries(group?.selections || {})
    return entries.length > 0 && entries.every(([key, value]) => selections[key] === value)
  }).flatMap(group => Array.isArray(group.images) ? group.images : [])
  const base = [...(Array.isArray(product.images) ? product.images : []), product.media_type === 'video' ? '' : product.media_url]
  const imageUrl = [...matched, ...base].map(publicImageUrl).find(Boolean) || ''
  return { description: String(product.description || '').trim(), imageUrl }
}

export function assertKnownOrderSelections(product, requested, selections) {
  if (requested == null) return
  if (typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Variações inválidas. Atualize o carrinho.')
  const known = new Set(Object.keys(selections))
  if (Object.entries(requested).some(([name, value]) => text(value) && !known.has(name))) {
    throw new Error(`As variações de ${product.name} foram alteradas. Atualize o carrinho e escolha novamente.`)
  }
}

export function buildOrderWhatsappMessage({ order, store, seller, catalog, subtotal, discount = 0, total, coupon }) {
  const items = Array.isArray(order.items) ? order.items : []
  const buyer = order.buyer || {}
  const lines = [`Olá! Montei este pedido na ${text(store.name)}:`]
  if (catalog?.name) lines.push(`Catálogo: ${text(catalog.name)}`)
  for (const item of items) {
    lines.push('', `*${Number(item.quantity)}x ${text(item.name || 'Produto')}*`)
    if (item.sku) lines.push(`Ref.: ${text(item.sku)}`)
    for (const [name, value] of Object.entries(item.selections || {})) {
      if (text(value)) lines.push(`${text(name)}: ${text(value)}`)
    }
    if (Number(item.unitsPerBox) > 1) lines.push(`Unidades por caixa: ${Number(item.unitsPerBox)}`, `Total de unidades: ${Number(item.stockUnits || item.quantity * item.unitsPerBox)}`)
    lines.push(`Valor unitário: ${money(item.unitPrice)}`, `Total do item: ${money(item.lineTotal)}`)
  }
  lines.push('')
  if (discount > 0) lines.push(`Subtotal: ${money(subtotal)}`, `Cupom ${text(coupon?.code)}: -${money(discount)}`)
  const extra = Number(order.extra_amount || 0)
  if (extra > 0) lines.push(`Valor extra: ${money(extra)}`)
  lines.push(`${extra > 0 ? 'Total do pedido' : 'Total dos produtos'}: ${money(total)}`, `Pedido: ${text(order.code)}`)
  for (const [label, value] of [['Comprador', buyer.name], ['Cidade', buyer.city], ['CEP', buyer.cep], ['Contato', buyer.phone], ['Observações', order.notes]]) {
    if (text(value)) lines.push(`${label}: ${text(value)}`)
  }
  lines.push('', `Quero finalizar com ${text(seller?.name || 'atendimento')}.`)
  return lines.join('\n')
}
