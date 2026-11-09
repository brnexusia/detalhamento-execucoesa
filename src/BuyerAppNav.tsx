import { Bookmark, House, Search, ShoppingBag, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { allStoredSocialCarts } from './social-cart'
import './buyer-app.css'

export function buyerGo(path:string){
 if(window.location.pathname+window.location.search===path)return
 window.dispatchEvent(new Event('shopvax:save-feed-position'))
 window.history.pushState({},'',path)
 window.dispatchEvent(new PopStateEvent('popstate'))
}
const links=[
 {href:'/feed',label:'Feed',Icon:House},
 {href:'/buscar',label:'Buscar',Icon:Search},
 {href:'/salvos',label:'Salvos',Icon:Bookmark},
 {href:'/carrinhos',label:'Carrinhos',Icon:ShoppingBag},
 {href:'/comprador',label:'Perfil',Icon:UserRound}
]
export default function BuyerAppNav({pathname}:{pathname:string}){
 const [count,setCount]=useState(()=>allStoredSocialCarts().reduce((n,c)=>n+c.cart.items.reduce((s,i)=>s+i.quantity,0),0))
 useEffect(()=>{
   const refresh=()=>setCount(allStoredSocialCarts().reduce((n,c)=>n+c.cart.items.reduce((s,i)=>s+i.quantity,0),0))
   window.addEventListener('shopvax:social-cart-change',refresh)
   window.addEventListener('storage',refresh)
   return()=>{window.removeEventListener('shopvax:social-cart-change',refresh);window.removeEventListener('storage',refresh)}
 },[])
 return <nav className="buyer-app-nav" aria-label="Navegação do comprador">
   <div className="buyer-app-nav__inner">{links.map(({href,label,Icon})=>{
     const active=href==='/feed'?['/','/feed','/descobrir'].includes(pathname)||pathname.startsWith('/perfil/'):pathname===href
     return <a key={href} href={href} aria-current={active?'page':undefined} className={active?'is-active':''}
       onClick={e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();buyerGo(href)}}>
       <span className="buyer-app-nav__icon"><Icon size={22} strokeWidth={active?2.5:1.85}/>
       {href==='/carrinhos'&&count>0&&<b>{count>99?'99+':count}</b>}</span>
       <span>{label}</span>
     </a>
   })}</div>
 </nav>
}
