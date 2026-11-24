import {useEffect,useState} from 'react'
import {LogOut,RefreshCcw,ShieldCheck} from 'lucide-react'
import {apiRequest} from './api'
import ShopvaxOrders,{type OrdersViewData} from './ShopvaxOrders'
import ShopvaxLoading from './ShopvaxLoading'
import './shopvax-orders.css'

export default function SellerOrdersPortal(){
  const [invite,setInvite]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('convite')||'')
  const [data,setData]=useState<OrdersViewData|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const load=async()=>{
    try{
      const result=await apiRequest<OrdersViewData>('/api/seller-orders',{cache:'no-store'})
      if(!result?.orders||!result.store||!result.sellers?.length)throw Error('O servidor não retornou uma sessão válida.')
      setData(result);setError('')
    }catch(e){setData(null);setError(e instanceof Error?e.message:'Não foi possível consultar seus pedidos.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{if(invite){window.history.replaceState({},'',window.location.pathname);setLoading(false)}else void load()},[])
  const enter=async()=>{
    if(busy||!invite)return
    setBusy(true);setError('')
    try{
      const result=await apiRequest<{ok:boolean}>('/api/seller-orders/session',{method:'POST',body:JSON.stringify({token:invite})})
      if(result?.ok!==true)throw Error('Não foi possível validar o convite.')
      setInvite('');await load()
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.')}
    finally{setBusy(false)}
  }
  const logout=async()=>{
    setBusy(true)
    try{
      const result=await apiRequest<{ok:boolean}>('/api/seller-orders/logout',{method:'POST',body:'{}'})
      if(result?.ok!==true)throw Error('Não foi possível encerrar a sessão.')
      setData(null);setInvite('');setError('')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível sair.')}
    finally{setBusy(false)}
  }
  if(loading)return <ShopvaxLoading label="Consultando seus pedidos…"/>
  return <main className="svx-seller-orders">
    <header className="svx-seller-orders__header"><a href="/" aria-label="Shopvax, início"><img src="/brand/shopvax-symbol.svg" alt=""/><img src="/brand/shopvax-wordmark.svg" alt="Shopvax"/></a><div>{data&&<><span>{data.sellers[0]?.name} · {data.store.name}</span><button onClick={()=>void load()} disabled={busy}><RefreshCcw size={16}/> Atualizar</button><button onClick={()=>void logout()} disabled={busy}><LogOut size={16}/> Sair</button></>}</div></header>
    {error&&<p role="alert" className="form-error">{error}</p>}
    {data?<ShopvaxOrders sellerMode data={data} onUpdated={load}/>:<section className="svx-seller-orders__auth"><ShieldCheck size={30}/><h1>Pedidos da vendedora</h1><p>{invite?'Use seu convite privado para acessar e editar os pedidos atribuídos a você.':'Solicite à administração da loja um convite privado de acesso aos seus pedidos.'}</p>{invite&&<button className="primary-action" onClick={()=>void enter()} disabled={busy}>{busy?'Verificando…':'Acessar meus pedidos'}</button>}</section>}
  </main>
}
