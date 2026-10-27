import { useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Clipboard, Package, ReceiptText, Search, XCircle } from 'lucide-react'
import type { AdminBootstrap, AdminOrder } from './types'
import { api } from './api'
import { SVRibbon, SVStamp } from './ShopvaxDesignSystem'

const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' })
const statusText: Record<string,string> = {
  whatsapp:'Aguardando confirmação',em_atendimento:'Em atendimento',
  confirmado:'Venda confirmada',arquivado:'Arquivado',cancelled:'Cancelado'
}

export function orderWhatsAppText(order: AdminOrder, storeName: string, sellerName: string) {
  return [
    `TALÃO ${order.code}`, `Loja: ${storeName}`, `Atendimento: ${sellerName}`, '',
    ...order.items.map(item => {
      const variation = Object.entries(item.selections || {}).map(([key,value]) => `${key}: ${value}`).join(' · ')
      return `${item.quantity}x ${item.name} [${item.sku || 'sem ref.'}]${variation ? ` (${variation})` : ''} — ${money.format(item.lineTotal)}`
    }), '',
    `Total: ${money.format(order.total)}`, `Situação: ${statusText[order.status] || order.status}`,
  ].join('\n')
}

type Props = { data: AdminBootstrap; onUpdated: () => void | Promise<void> }
const allowed = ['whatsapp','em_atendimento','confirmado','arquivado'] as const

export default function ShopvaxOrders({data,onUpdated}: Props) {
  const [query,setQuery] = useState('')
  const [status,setStatus] = useState('all')
  const [period,setPeriod] = useState('30')
  const [selected,setSelected] = useState<string | null>(null)
  const [busy,setBusy] = useState('')
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const sellerName = (sellerId?: string | null) => data.sellers.find((seller) => seller.id === sellerId)?.name || 'Loja'
  const since = period === 'all' ? 0 : Date.now()-Number(period)*86400000
  const orders = [...data.orders].filter(order => {
    const haystack = [order.code, sellerName(order.seller_id), ...order.items.flatMap(i=>[i.name,i.sku])].join(' ').toLocaleLowerCase('pt-BR')
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase('pt-BR')))
      && (status === 'all' || order.status === status)
      && (!since || Date.parse(order.created_at)>=since)
  }).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))
  const active = data.orders.find(o=>o.id===selected) || null
  const update = async (order: AdminOrder, next: string) => {
    if (!allowed.includes(next) || next===order.status || busy) return
    setError(''); setBusy(order.id)
    try {
      await api.updateOrderStatus(order.id,next as typeof allowed[number])
      await onUpdated()
      setNotice(`Talão ${order.code}: ${statusText[next]}.`)
    } catch(err){ setError(err instanceof Error?err.message:'Não foi possível atualizar o pedido.') }
    finally {setBusy('')}
  }
  const cancel = async (order: AdminOrder) => {
    if (busy || order.status==='cancelled') return
    if (!window.confirm(`Cancelar o talão ${order.code}? O estoque reservado será devolvido. Esta ação não pode ser desfeita.`)) return
    setError(''); setBusy(order.id)
    try {
      await api.cancelOrder(order.id)
      await onUpdated()
      setNotice(`Talão ${order.code} cancelado e estoque devolvido.`)
    } catch(err){setError(err instanceof Error?err.message:'Não foi possível cancelar o pedido.')}
    finally {setBusy('')}
  }
  const copy = async(order: AdminOrder) => {
    setError('')
    try { await navigator.clipboard.writeText(orderWhatsAppText(order,data.store.name,sellerName(order.seller_id))); setNotice(`Resumo ${order.code} copiado.`) }
    catch { setError('Não foi possível copiar o talão. Confira as permissões do navegador.') }
  }
  return <div className="panel-page svx-orders">
    <SVRibbon><span>SHOPVAX · TALÕES RECEBIDOS</span><span>Pedidos e atendimento</span></SVRibbon>
    <header className="svx-orders__header"><div><span className="svx-kicker">CONTROLE DO BALCÃO</span><h1>Talões de pedido</h1><p>Um talão preparado no Shopvax não comprova mensagem entregue ou pagamento. A confirmação da venda é responsabilidade da loja.</p></div><strong>{orders.length}<small>pedidos no filtro</small></strong></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="svx-orders__notice" role="status"><Check size={15}/>{notice}</p>}
    <div className="svx-orders__filters"><label><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar referência, peça ou vendedora"/></label><select value={status} onChange={event=>setStatus(event.target.value)} aria-label="Filtrar por status"><option value="all">Todos os estados</option>{Object.entries(statusText).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select value={period} onChange={event=>setPeriod(event.target.value)} aria-label="Filtrar por período"><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="all">Todo o período</option></select></div>
    <div className="svx-orders__columns"><section className="svx-orders__listing"><div className="svx-orders__list-head"><span>Talão</span><span>Atendimento</span><span>Valor</span><span>Status</span></div>{orders.map(order=><button key={order.id} className={`svx-orders__row ${selected===order.id?'is-active':''}`} type="button" onClick={()=>{setSelected(order.id);setError('')}} aria-label={`Ver talão ${order.code}`}>
      <span><strong>{order.code}</strong><small>{date.format(new Date(order.created_at))}</small></span><span>{sellerName(order.seller_id)}<small>{order.items.reduce((n,i)=>n+i.quantity,0)} peça(s)</small></span><strong>{money.format(order.total)}</strong><span className="svx-orders__status">{statusText[order.status]||order.status}<ChevronRight size={14}/></span>
    </button>)}{!orders.length && <div className="svx-orders__empty"><ReceiptText size={27}/><strong>{data.orders.length?'Nenhum talão neste filtro.':'Nenhum pedido registrado ainda.'}</strong><p>{data.orders.length?'Ajuste os filtros para procurar outro pedido.':'Os pedidos preparados pelo catálogo aparecem aqui.'}</p></div>}</section>
    <aside className="svx-orders__detail">{active?<><div className="svx-orders__detail-top"><div><span className="svx-kicker">TALÃO DE PEDIDO</span><h2>{active.code}</h2></div><SVStamp>{active.status==='confirmado'?'CONFIRMADO':active.status==='cancelled'?'CANCELADO':'NA GRADE'}</SVStamp></div><div className="svx-orders__detail-meta"><span>Atendimento <strong>{sellerName(active.seller_id)}</strong></span><span>Registrado <strong>{date.format(new Date(active.created_at))}</strong></span></div><div className="svx-orders__items">{active.items.map((item,i)=><div className="svx-orders__item" key={i}><span className="svx-orders__item-n">{String(i+1).padStart(2,'0')}</span><div><strong>{item.name}</strong><small>REF. {item.sku||'—'}</small><p>{Object.entries(item.selections||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p><span>{item.quantity} × {money.format(item.unitPrice)}</span></div><strong>{money.format(item.lineTotal)}</strong></div>)}</div><div className="svx-orders__total"><span>TOTAL DO TALÃO</span><strong>{money.format(active.total)}</strong></div><div className="svx-orders__actions"><button onClick={()=>void copy(active)}><Clipboard size={16}/> Copiar talão</button><label>Andamento<select aria-label="Alterar estado do pedido" disabled={busy===active.id||active.status==='cancelled'} value={active.status} onChange={e=>void update(active,e.target.value)}><option value="whatsapp">Aguardando confirmação</option><option value="em_atendimento">Em atendimento</option><option value="confirmado">Venda confirmada</option><option value="arquivado">Arquivado</option>{active.status==='cancelled'&&<option value="cancelled">Cancelado</option>}</select></label>{active.status!=='cancelled'&&<button disabled={busy===active.id} className="svx-orders__cancel" onClick={()=>void cancel(active)}><XCircle size={16}/> Cancelar e devolver estoque</button>}</div></>:<div className="svx-orders__placeholder"><Package size={35}/><h2>Selecione um talão</h2><p>Confira grade, valores, vendedora e andamento do pedido sem sair do painel.</p><ArrowLeft size={17}/></div>}</aside></div>
  </div>
}
