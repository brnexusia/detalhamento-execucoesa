import { useEffect, useState } from 'react'
import { ArrowLeft, Bookmark, CheckCircle2, ChevronRight, ClipboardList, LogOut, ShoppingBag, Store, UserRound, UserRoundPen } from 'lucide-react'
import BuyerWhatsappLogin from './BuyerWhatsappLogin'
import { apiRequest } from './api'
import { buyerGo } from './BuyerAppNav'
import { resetSocialSaveSession } from './social-saves'
import { useOwnerSession } from './owner-session'
import './customer-account.css'
import './buyer-app.css'

type GlobalBuyer={
 id:string;phone:string;name:string;document?:string;profileCompleted:boolean
}
type BuyerOrder={
 id:string;code:string;total:number;status:string;createdAt:string;catalogName:string
 store:{id:string;slug:string;name:string;logoUrl:string}
 items:Array<{name:string;quantity:number;lineTotal:number}>
}
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const status=(value:string)=>{
 if(value==='whatsapp')return 'Pedido preparado'
 if(value==='em_atendimento')return 'Em atendimento'
 if(value==='confirmado')return 'Confirmado pela loja'
 if(value==='cancelled')return 'Cancelado'
 if(value==='arquivado')return 'Arquivado'
 return 'Situação em atualização'
}
function safeNext():string{
 const value=new URLSearchParams(location.search).get('next')||''
 if(['/','/feed','/descobrir','/buscar','/salvos','/carrinhos'].includes(value))return value
 if(/^\/(?:buscar)(?:\?[^#]{0,220})$/.test(value))return value
 if(/^\/(?:perfil|cliente)\/[a-z0-9_-]+(?:\?produto=[a-z0-9_-]+)?$/i.test(value))return value
 return ''
}
function SellerAccess(){
 const ownerSession=useOwnerSession()
 const isOwner=ownerSession==='authenticated'
 return <section className="buyer-seller-section" aria-labelledby="buyer-seller-title">
   <span className="buyer-seller-section__eyebrow">PARA QUEM VENDE</span>
   <div className="buyer-seller-section__card">
     <div className="buyer-seller-section__intro"><span className="buyer-seller-section__icon"><Store size={23} aria-hidden="true"/></span>
       <div><h2 id="buyer-seller-title">{isOwner?'Minha loja':'Venda com a ShopVax'}</h2>
         <p>{isOwner?'Acesse seu painel e gerencie sua loja.':'Crie sua loja digital e receba pedidos pelo WhatsApp.'}</p></div></div>
     {isOwner?<a className="buyer-seller-section__primary" href="/painel">Gerenciar minha loja <ChevronRight size={17} aria-hidden="true"/></a>
       :<div className="buyer-seller-section__actions">
          <a className="buyer-seller-section__primary" href="/para-lojas">Conhecer e criar minha loja <ChevronRight size={17} aria-hidden="true"/></a>
          <a className="buyer-seller-section__secondary" href="/entrar">Já sou lojista · Entrar</a>
        </div>}
   </div>
 </section>
}

export default function GlobalBuyerAccount(){
 const [buyer,setBuyer]=useState<GlobalBuyer|null>(null)
 const [orders,setOrders]=useState<BuyerOrder[]>([])
 const [loading,setLoading]=useState(true)
 const [ordersLoading,setOrdersLoading]=useState(false)
 const [editing,setEditing]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [ordersError,setOrdersError]=useState('')
 const refresh=async()=>{
   try{
     const result=await apiRequest<{buyer:GlobalBuyer}>('/api/public/buyer-auth/me')
     setBuyer(result.buyer);setError('')
     if(result.buyer.profileCompleted){
       const destination=safeNext()
       if(destination){buyerGo(destination);return true}
       setOrdersLoading(true)
       try{
         const history=await apiRequest<{orders:BuyerOrder[]}>('/api/social/buyer/orders')
         setOrders(Array.isArray(history.orders)?history.orders:[]);setOrdersError('')
       }catch(e){setOrdersError(e instanceof Error?e.message:'Não foi possível carregar os pedidos.')}
       finally{setOrdersLoading(false)}
     }
     return true
   }catch(e){
     setBuyer(null)
     const status=(e as Error&{status?:number}).status
     if(status!==401)setError(e instanceof Error?e.message:'Não foi possível consultar a conta.')
     return false
   }finally{setLoading(false)}
 }
 useEffect(()=>{void refresh()},[])
 const logout=async()=>{
   if(busy)return
   setBusy(true);setError('')
   try{
     await apiRequest('/api/auth/logout-all',{method:'POST'})
     setBuyer(null);setOrders([]);resetSocialSaveSession()
   }catch(e){setError(e instanceof Error?e.message:'Não foi possível sair.')}
   finally{setBusy(false)}
 }
 const cards=[
   {Icon:Bookmark,title:'Salvos',detail:'Produtos favoritos',path:'/salvos'},
   {Icon:Store,title:'Seguindo',detail:'Lojas que acompanho',path:'/salvos?aba=lojas'},
   {Icon:ShoppingBag,title:'Carrinhos',detail:'Pedidos em montagem',path:'/carrinhos'},
   {Icon:UserRoundPen,title:'Meus dados',detail:'Nome e CPF/CNPJ',path:''}
 ]
 return <main className="buyer-screen"><div className="buyer-screen__inner">
   <header className="buyer-screen__head"><div><small>Minha experiência</small><h1>Meu perfil</h1></div><UserRound size={24}/></header>
   {loading?<p className="buyer-state" role="status">Abrindo sua conta…</p>:
    buyer?.profileCompleted?<div>
      <section className="buyer-profile-identity"><span className="buyer-profile-identity__avatar"><UserRound size={29}/></span>
        <div><h2>{buyer.name}</h2><p>{buyer.phone} · Telefone verificado</p></div></section>
      <div className="buyer-profile-grid">{cards.map(({Icon,title,detail,path})=>path
        ? <a key={title} href={path} onClick={e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();buyerGo(path)}}>
            <Icon size={24}/><strong>{title}</strong><small>{detail}</small><ChevronRight size={14}/></a>
        : <button key={title} type="button" aria-expanded={editing} onClick={()=>setEditing(v=>!v)}><Icon size={24}/><strong>{title}</strong><small>{detail}</small><ChevronRight size={14}/></button>)}</div>
      {editing&&<section className="buyer-section"><h2 className="buyer-section__heading">Editar perfil</h2>
        <BuyerWhatsappLogin editOnly onVerified={async()=>{setEditing(false);return refresh()}}/></section>}
      <section className="buyer-section" id="pedidos"><div className="buyer-screen__head"><div><small>Minhas compras</small><h2 className="buyer-section__heading">Meus pedidos</h2></div><ClipboardList size={21}/></div>
        <p className="buyer-screen__hint">Pedidos de todas as lojas em que você comprou com sua conta. Pedido preparado não significa compra paga ou mensagem enviada.</p>
        {ordersLoading&&<p role="status" className="buyer-state">Carregando pedidos…</p>}
        {ordersError&&<p role="alert" className="buyer-state">{ordersError}<button className="buyer-inline-link" onClick={()=>void refresh()}>Tentar novamente</button></p>}
        {!ordersLoading&&!ordersError&&(orders.length?orders.map(order=><article className="buyer-order-card" key={order.id}>
          <div className="buyer-order-card__head"><div><strong>{order.store.name}</strong><small> · {order.catalogName||'Catálogo da loja'}</small></div><small>{new Date(order.createdAt).toLocaleDateString('pt-BR')}</small></div>
          <p>{order.items.map(i=>i.quantity+'× '+i.name).join(' · ')}</p>
          <div className="buyer-order-card__head"><div><b>{money.format(order.total)}</b><p>{status(order.status)} · {order.code}</p></div>
            <button className="buyer-secondary-button" onClick={()=>buyerGo('/perfil/'+encodeURIComponent(order.store.slug))}>Ver loja</button></div>
        </article>):<div className="buyer-empty">Você ainda não possui pedidos vinculados a esta conta. <button className="buyer-inline-link" onClick={()=>buyerGo('/feed')}>Descobrir produtos</button></div>)}
      </section>
      <div className="buyer-section"><button type="button" className="buyer-secondary-button" disabled={busy} onClick={()=>void logout()}><LogOut size={16}/>{busy?'Saindo…':'Sair da conta'}</button></div>
    </div>:<section className="buyer-section"><div className="buyer-profile-identity"><span className="buyer-profile-identity__avatar"><UserRound size={27}/></span><div><h2>Bem-vindo ao ShopVax</h2><p>Explore sem cadastro. Entre com WhatsApp para consultar preços e acompanhar pedidos.</p></div></div><BuyerWhatsappLogin onVerified={refresh}/></section>}
   {error&&<p role="alert" className="buyer-state">{error}</p>}
   <SellerAccess/>
 </div></main>
}
