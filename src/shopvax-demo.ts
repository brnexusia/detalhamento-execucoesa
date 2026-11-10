/** Loja fictícia usada pelo botão "Ver loja demo" do marketing. */
export const SHOPVAX_DEMO_STORE_SLUG = 'casa-norte'

export function isShopvaxDemoStore(slug: string): boolean {
  return slug === SHOPVAX_DEMO_STORE_SLUG
}
