export type SocialOffer = { id: string; slug: string; name: string; kind: 'varejo'|'atacado'|'geral'; price: number; minimumOrder: number; unitsPerBox: number }
export type SocialCartLine = { key: string; productId: string; name: string; sku: string; quantity: number; price: number; selections: Record<string,string>; image: string; unitsPerBox: number }
export type SocialCart = { catalog: SocialOffer; items: SocialCartLine[] }

const prefix = (slug:string) => `shopvax-social-cart-v1:${encodeURIComponent(slug)}:`
const keyFor = (slug:string,catalog:string) => prefix(slug)+encodeURIComponent(catalog)
export const socialReadyKey = (slug:string,catalog:string) => 'shopvax-social-ready-v1:'+encodeURIComponent(slug)+':'+encodeURIComponent(catalog)

export function readSocialCart(slug:string,catalog:string): SocialCart | null {
  try {
    const raw=localStorage.getItem(keyFor(slug,catalog))
    if(!raw)return null
    const data=JSON.parse(raw) as SocialCart
    return Array.isArray(data.items)&&data.catalog?.slug===catalog?data:null
  } catch { return null }
}
export function allSocialCarts(slug:string):SocialCart[] {
  const list:SocialCart[]=[]
  try {
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i)||''
      if(!key.startsWith(prefix(slug)))continue
      const cart=readSocialCart(slug,decodeURIComponent(key.slice(prefix(slug).length)))
      if(cart?.items.length)list.push(cart)
    }
  } catch { /* storage may be unavailable */ }
  return list
}
export function socialCartCount(slug:string):number {
  return allSocialCarts(slug).reduce((n,c)=>n+c.items.reduce((t,i)=>t+i.quantity,0),0)
}
export function persistSocialCart(slug:string,cart:SocialCart):void {
  try {
    const key=keyFor(slug,cart.catalog.slug)
    if(cart.items.length)localStorage.setItem(key,JSON.stringify(cart))
    else localStorage.removeItem(key)
  } catch { /* storage may be unavailable */ }
  try { sessionStorage.removeItem(socialReadyKey(slug,cart.catalog.slug)) } catch {}
  window.dispatchEvent(new CustomEvent('shopvax:social-cart-change',{detail:{storeSlug:slug}}))
}

export function allStoredSocialCarts():Array<{storeSlug:string,cart:SocialCart}>{
 const result:Array<{storeSlug:string,cart:SocialCart}>=[]
 try{
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i)||''
   if(!key.startsWith('shopvax-social-cart-v1:'))continue
   const parts=key.slice('shopvax-social-cart-v1:'.length).split(':')
   if(parts.length!==2)continue
   const storeSlug=decodeURIComponent(parts[0]),catalogSlug=decodeURIComponent(parts[1])
   const cart=readSocialCart(storeSlug,catalogSlug)
   if(cart?.items.length)result.push({storeSlug,cart})
  }
 }catch{}
 return result.sort((a,b)=>a.storeSlug.localeCompare(b.storeSlug)||a.cart.catalog.name.localeCompare(b.cart.catalog.name))
}
