import { lazy, Suspense, useEffect, useState } from 'react'
import { Minus, Plus, ShoppingBag, Store } from 'lucide-react'
import { buyerGo } from './BuyerAppNav'
import { allStoredSocialCarts, persistSocialCart } from './social-cart'
import type { SocialCart } from './social-cart'
import './buyer-app.css'
const SocialShopping=lazy(()=>import('./SocialShopping'))
type Entry={storeSlug:string;cart:SocialCart}
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
export default function SocialCarts(){
 const [entries,setEntries]=useState<Entry[]>(allStoredSocialCarts)
 const [opened,setOpened]=useState<string|null>(null)
 const [names,setNames]=useState<Record<string,string>>({})
 const refresh=()=>setEntries(allStoredSocialCarts())
 useEffect(()=>{
  window.addEventListener('shopvax:social-cart-change',refresh)
  window.addEventListener('storage',refresh)
  const onFocus=()=>refresh()
  window.addEventListener('focus',onFocus)
  return()=>{window.removeEventListener('shopvax:social-cart-change',refresh);window.removeEventListener('storage',refresh);window.removeEventListener('focus',onFocus)}
 },[])
 useEffect(()=>{
  const slugs=[...new Set(entries.map(e=>e.storeSlug))].filter(s=>!names[s])
  let live=true
  if(slugs.length)void Promise.all(slugs.map(async slug=>{
   try{const r=await fetch('/api/social/stores/'+encodeURIComponent(slug),{credentials:'include'});const body=await r.json()
     return [slug,r.ok?String(body.store?.name||slug):slug] as const
   }catch{return [slug,slug] as const}
  })).then(list=>{if(live)setNames(prev=>({...prev,...Object.fromEntries(list)}))})
  return()=>{live=false}
 },[entries.map(e=>e.storeSlug).join('|')])
 const setQty=(entry:Entry,key:string,delta:number)=>{
  persistSocialCart(entry.storeSlug,{...entry.cart,items:entry.cart.items.map(i=>i.key===key?{...i,quantity:Math.max(0,i.quantity+delta)}:i).filter(i=>i.quantity>0)})
  refresh()
 }
 const sum=(cart:SocialCart)=>cart.items.reduce((n,x)=>n+x.price*x.quantity,0)
 const selected=opened?entries.find(e=>e.storeSlug+':'+e.cart.catalog.slug===opened):null
 return <main className="buyer-screen"><div className="buyer-screen__inner">
  <header className="buyer-screen__head"><div><small>Seus pedidos em montagem</small><h1>Carrinhos</h1></div><ShoppingBag size={25}/></header>
  <p className="buyer-screen__hint">Cada loja e modalidade mantém seu próprio carrinho. Preços, estoques e mínimos são confirmados novamente antes do pedido.</p>
  {entries.length===0?<div className="buyer-empty"><ShoppingBag size={28}/><p>Você ainda não adicionou nenhum produto.</p><button className="buyer-primary-button" onClick={()=>buyerGo('/feed')}>Explorar produtos</button></div>:
   entries.map(e=>{
    const total=sum(e.cart),min=e.cart.catalog.minimumOrder,hasMin=total>=min
    return <section className="buyer-cart-group" key={e.storeSlug+':'+e.cart.catalog.slug}>
     <div className="buyer-cart-group__head"><div><h2>{names[e.storeSlug]||e.storeSlug}</h2><small>{e.cart.catalog.name} · {e.cart.catalog.kind==='caixa_fechada'?'Caixa fechada':e.cart.catalog.kind==='atacado'?'Atacado':e.cart.catalog.kind==='varejo'?'Varejo':e.cart.catalog.kind==='personalizado'?e.cart.catalog.customLabel||'Personalizado':'Compra'}</small></div>
       <button className="buyer-secondary-button" onClick={()=>buyerGo('/perfil/'+encodeURIComponent(e.storeSlug))}><Store size={16}/> Ver loja</button></div>
     {e.cart.items.map(item=><div className="buyer-cart-line" key={item.key}>
       {item.image?<img src={item.image} alt="" loading="lazy"/>:<span><ShoppingBag size={24}/></span>}
       <div className="buyer-cart-line__main"><strong>{item.name}</strong><small>{Object.entries(item.selections).map(([k,v])=>k+': '+v).join(' · ')||item.sku}</small>
         <small>{item.unitsPerBox>1?`${item.unitsPerBox} unidades por caixa · `:''}{currency.format(item.price)} cada</small></div>
       <div className="buyer-cart-stepper"><button aria-label={'Diminuir '+item.name} onClick={()=>setQty(e,item.key,-1)}><Minus size={15}/></button><span>{item.quantity}</span><button aria-label={'Aumentar '+item.name} onClick={()=>setQty(e,item.key,1)}><Plus size={15}/></button></div>
     </div>)}
     <div className="buyer-cart-totals"><div><span>Total estimado</span><strong>{currency.format(total)}</strong></div><div><span>Pedido mínimo</span><strong>{currency.format(min)}</strong></div>
       {!hasMin&&<p>Faltam {currency.format(min-total)} para atingir o mínimo deste catálogo.</p>}</div>
     <button className="buyer-primary-button" onClick={()=>setOpened(e.storeSlug+':'+e.cart.catalog.slug)}>{hasMin?'Revisar pedido':'Ver carrinho'}</button>
   </section>
   })
  }
  {selected&&<Suspense fallback={<p role="status">Abrindo seu carrinho…</p>}><SocialShopping storeSlug={selected.storeSlug} storeName={names[selected.storeSlug]||selected.storeSlug} initialCatalogSlug={selected.cart.catalog.slug} initialCart onCartChanged={refresh} onClose={()=>{setOpened(null);refresh()}}/></Suspense>}
 </div></main>
}
