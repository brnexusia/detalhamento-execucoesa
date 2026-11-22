/**
 * Domínio canônico público do ShopVax.
 * Nunca construir links de divulgação com window.location.origin:
 * o painel também pode ser aberto pelo endereço interno do EasyPanel.
 */
export const SHOPVAX_PUBLIC_ORIGIN = 'https://shopvax.com.br'

export function publicStoreLink(storeSlug: string): string {
  return `${SHOPVAX_PUBLIC_ORIGIN}/${encodeURIComponent(storeSlug)}`
}

export function publicSellerLink(storeSlug: string, sellerSlug: string): string {
  return `${publicStoreLink(storeSlug)}/${encodeURIComponent(sellerSlug)}`
}

/** ShopVax URLs: /loja/catalogo/pasta or /loja/vendedora/pasta.
 * "catalogo" is reserved in the third segment. Preserve a legacy seller of
 * that exact slug using ?catalog so an existing seller is never lost.
 */
export function publicCatalogLink(storeSlug: string, catalogSlug: string, sellerSlug?: string): string {
  const catalog = encodeURIComponent(catalogSlug)
  if (!sellerSlug) return publicStoreLink(storeSlug) + '/catalogo/' + catalog
  if (sellerSlug.toLowerCase() === 'catalogo') return publicSellerLink(storeSlug,sellerSlug) + '?catalog=' + catalog
  return publicSellerLink(storeSlug,sellerSlug) + '/' + catalog
}
export function parsePublicStorePath(pathname: string): {storeSlug: string; sellerSlug?: string; catalogSlug?: string} {
  const parts = pathname.split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s) } catch { return s }
  })
  const [storeSlug, sellerOrPrefix, catalogSlug] = parts
  if (!sellerOrPrefix) return {storeSlug:storeSlug || ''}
  if (!catalogSlug) return {storeSlug:storeSlug || '',sellerSlug:sellerOrPrefix}
  if (sellerOrPrefix === 'catalogo') return {storeSlug:storeSlug || '',catalogSlug}
  return {storeSlug:storeSlug || '',sellerSlug:sellerOrPrefix,catalogSlug}
}

export function publicReferralLink(referralCode: string): string {
  return `${SHOPVAX_PUBLIC_ORIGIN}/criar-conta?ref=${encodeURIComponent(referralCode)}`
}


/**
 * Canonicaliza URLs de divulgação da loja/vendedora mesmo quando a área
 * administrativa está aberta pelo endereço técnico do EasyPanel.
 * Preserva rota, slug, parâmetros e fragmento; não altera links externos.
 */
export function canonicalPublicShareLink(value: string): string {
  const parsed = new URL(value, SHOPVAX_PUBLIC_ORIGIN)
  const publicOrigin = new URL(SHOPVAX_PUBLIC_ORIGIN)
  const isPublicHost = parsed.origin === publicOrigin.origin
  const isEasyPanelHost = parsed.protocol === 'https:' && /^[a-z0-9-]+\.easypanel\.host$/i.test(parsed.hostname)
  if (!isPublicHost && !isEasyPanelHost) {
    throw new Error('O link informado não pertence à loja no ShopVax.')
  }
  return `${SHOPVAX_PUBLIC_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`
}
