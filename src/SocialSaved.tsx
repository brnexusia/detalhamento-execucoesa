import { Bookmark, Heart, Play, Store, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buyerGo } from './BuyerAppNav'
import { listSocialSaved, localSocialSaved, socialSaveEvent, toggleSocialSaved } from './social-saves'
import type { SocialSavedProduct, SocialFollowedStore } from './social-saves'
import './buyer-app.css'

function go(path:string,e:React.MouseEvent<HTMLAnchorElement>){
 if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return
 e.preventDefault();buyerGo(path)
}
export default function SocialSaved(){
 const [tab,setTab]=useState<'products'|'stores'>(()=>new URLSearchParams(location.search).get('aba')==='lojas'?'stores':'products')
 const [products,setProducts]=useState<SocialSavedProduct[]>(localSocialSaved)
 const [stores,setStores]=useState<SocialFollowedStore[]>([])
 const [authenticated,setAuthenticated]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
  let active=true
  const load=async()=>{
   try{
    const data=await listSocialSaved()
    if(active){setProducts(data.products);setStores(data.stores);setAuthenticated(data.authenticated);setError('')}
   }catch(e){if(active)setError(e instanceof Error?e.message:'Falha ao carregar salvos.')}
   finally{if(active)setLoading(false)}
  }
  void load()
  const refresh=()=>{if(active)setProducts(localSocialSaved())}
  const onFocus=()=>{void load()}
  window.addEventListener(socialSaveEvent,refresh)
  window.addEventListener('focus',onFocus)
  return()=>{active=false;window.removeEventListener(socialSaveEvent,refresh);window.removeEventListener('focus',onFocus)}
 },[])
 const remove=async(p:SocialSavedProduct)=>{
  setProducts(current=>current.filter(x=>x.id!==p.id))
  await toggleSocialSaved(p)
  // O resultado remoto pode ter sofrido atualização entre sessões.
  const next=await listSocialSaved()
  setProducts(next.products)
 }
 return <main className="buyer-screen"><div className="buyer-screen__inner">
  <header className="buyer-screen__head"><div><small>Seu ShopVax</small><h1>Salvos</h1></div><Bookmark size={23}/></header>
  <p className="buyer-screen__hint">Guarde o que chamou sua atenção e retome depois, sem perder a loja de origem.</p>
  <div className="buyer-tabs">
   <button type="button" aria-pressed={tab==='products'} onClick={()=>setTab('products')}>Produtos ({products.length})</button>
   <button type="button" aria-pressed={tab==='stores'} onClick={()=>setTab('stores')}>Lojas seguindo ({stores.length})</button>
  </div>
  {loading&&<p className="buyer-state" role="status">Carregando seus salvos…</p>}
  {error&&<p className="buyer-state" role="alert">{error}</p>}
  {!loading&&tab==='products'&&(products.length?<div className="buyer-product-grid">{products.map(p=>{
   const path='/perfil/'+encodeURIComponent(p.store.slug)+'?produto='+encodeURIComponent(p.id)
   return <div className="buyer-product-card" key={p.id}>
    <a className="buyer-product-card__image" href={path} onClick={e=>go(path,e)}>{p.mediaType==='video'?(p.thumbnailUrl?<img src={p.thumbnailUrl} alt={p.name} loading="lazy"/>:<span className="buyer-video-placeholder"><Play size={24}/><small>Vídeo</small></span>):p.mediaUrl?<img src={p.mediaUrl} alt={p.name} loading="lazy"/>:<Store size={24}/>}</a>
    <span className="buyer-product-card__details"><strong>{p.name}</strong><small>{p.store.name}</small>
     <a className="buyer-inline-link" href={path} onClick={e=>go(path,e)}>Ver produto</a>
     <button type="button" className="buyer-inline-link" onClick={()=>void remove(p)} aria-label={'Remover '+p.name+' dos salvos'}><Trash2 size={14}/> Remover</button>
    </span>
   </div>
  })}</div>:<div className="buyer-empty"><Heart size={27}/><p>Você ainda não salvou produtos.</p><button className="buyer-primary-button" onClick={()=>buyerGo('/feed')}>Descobrir produtos</button></div>)}
  {!loading&&tab==='stores'&&(authenticated
   ? stores.length?<div className="buyer-stores">{stores.map(store=>{
     const path='/perfil/'+encodeURIComponent(store.slug)
     return <a key={store.id} className="buyer-store-card" href={path} onClick={e=>go(path,e)}><span className="buyer-store-card__avatar">{store.logoUrl?<img src={store.logoUrl} alt="" loading="lazy"/>:<Store size={22}/>}</span><span className="buyer-store-card__body"><strong>{store.name}</strong><small>{store.productCount||0} produtos publicados</small></span></a>
   })}</div>:<div className="buyer-empty">Você ainda não segue lojas. Explore o feed e toque em Seguir no perfil de uma loja.</div>
   :<div className="buyer-empty"><p>Entre com WhatsApp para ver todas as lojas que você segue.</p><button className="buyer-primary-button" onClick={()=>buyerGo('/comprador?next=%2Fsalvos')}>Entrar</button></div>)}
 </div></main>
}
