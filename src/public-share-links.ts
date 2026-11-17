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

export function publicCatalogLink(storeSlug: string, catalogSlug: string): string {
  return `${publicStoreLink(storeSlug)}?catalog=${encodeURIComponent(catalogSlug)}`
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
