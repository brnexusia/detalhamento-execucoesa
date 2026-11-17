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
