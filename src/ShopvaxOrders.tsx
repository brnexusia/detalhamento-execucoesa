import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Clipboard, Package, ReceiptText, Search, Trash2, XCircle, Pencil, Plus, X } from 'lucide-react'
import type { AdminBootstrap, AdminOrder, AdminProduct } from './types'
import { api } from './api'
import { confirmAction } from './ui-dialogs'
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
    `Total: ${money.format(order.total)}`,
    ...(order.buyer?.name ? [`Comprador: ${order.buyer.name}`] : []),
    ...(order.buyer?.city ? [`Cidade: ${order.buyer.city}`] : []),
    ...(order.buyer?.cep ? [`CEP: ${order.buyer.cep}`] : []),
    ...(order.buyer?.phone ? [`Contato: ${order.buyer.phone}`] : []),
    ...(order.notes?.trim() ? [`Observações: ${order.notes.trim()}`] : []),
    `Situação: ${statusText[order.status] || order.status}`,
  ].join('\n')
}

type EditLine = { key: number; originalIndex?: number; productId?: string; name: string; sku: string; quantity: string; unitPrice: string; selections: Record<string,string>; product?: AdminProduct }
function editable(order: AdminOrder) {
  return ['whatsapp','em_atendimento','confirmado'].includes(order.status) && !order.stock_reverted && (!order.payment_status || order.payment_status==='none') && !order.shipping_method && !Number(order.shipping_amount||0)
}
function OrderEditor({order,onClose,onSaved}:{order:AdminOrder;onClose:()=>void;onSaved:(order:AdminOrder)=>void}) {
  const [lines,setLines]=useState<EditLine[]>(()=>order.items.map((item,index)=>({key:index,originalIndex:index,productId:item.productId,name:item.name,sku:item.sku,quantity:String(item.quantity),unitPrice:String(item.unitPrice),selections:item.selections||{}})))
  const nextKey=useRef(order.items.length)
  const [search,setSearch]=useState('')
  const [results,setResults]=useState<AdminProduct[]>([])
  const [searching,setSearching]=useState(false)
  const [searchError,setSearchError]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    if(!search.trim()){setResults([]);setSearching(false);setSearchError('');return}
    let current=true
    setSearching(true);setSearchError('');setResults([])
    const timer=window.setTimeout(()=>{
      void api.listAdminProducts({page:1,limit:20,q:search,catalogId:order.catalog_id||undefined}).then(r=>{if(current)setResults(r.products.filter(p=>p.active))}).catch(e=>{if(current)setSearchError(e instanceof Error?e.message:'Não foi possível buscar produtos.')}).finally(()=>{if(current)setSearching(false)})
    },250)
    return()=>{current=false;window.clearTimeout(timer)}
  },[search,order.catalog_id])
  const patch=(key:number,change:Partial<EditLine>)=>setLines(prev=>prev.map(line=>line.key===key?{...line,...change}:line))
  const add=(product:AdminProduct)=>{
    const selections=Object.fromEntries((product.variations||[]).filter(g=>g.options.length===1).map(g=>[g.name,g.options[0]]))
    setLines(prev=>[...prev,{key:nextKey.current++,productId:product.id,name:product.name,sku:product.sku,quantity:'1',unitPrice:String(product.catalogPrice??product.price),selections,product}])
    setSearch('');setResults([])
  }
  const chooseVariation=(line:EditLine,group:string,value:string)=>{
    const selections={...line.selections,[group]:value}
    const config=line.product?.variant_prices
    const base=Number(line.product?.price||0),effective=Number(line.product?.catalogPrice??base)
    const variant=config&&selections[config.group]&&config.prices[selections[config.group]]
    patch(line.key,{selections,...(config?.group===group&&variant&&base>0?{unitPrice:String(Math.round(variant/base*effective*100)/100)}:{})})
  }
  const total=lines.reduce((sum,line)=>sum+(Number(line.quantity)||0)*Math.round((Number(line.unitPrice)||0)*100),0)/100
  const close=async()=>{
    if(busy)return
    if(await confirmAction('Descartar as alterações não salvas deste pedido?','Fechar edição','Descartar alterações'))onClose()
  }
  const save=async(event:React.FormEvent)=>{
    event.preventDefault()
    if(busy||!lines.length)return
    if(lines.some(line=>line.quantity.trim()===''||line.unitPrice.trim()===''||!Number.isSafeInteger(Number(line.quantity))||Number(line.quantity)<1||Number(line.quantity)>999||!Number.isFinite(Number(line.unitPrice))||Number(line.unitPrice)<0)){setError('Confira as quantidades e os valores.');return}
    setBusy(true);setError('')
    try{
      const result=await api.editOrder(order.id,{revision:order.edit_revision||0,items:lines.map(line=>({originalIndex:line.originalIndex,productId:line.productId,quantity:Number(line.quantity),unitPrice:Number(line.unitPrice),selections:line.selections}))})
      onSaved(result.order)
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar o pedido.')}
    finally{setBusy(false)}
  }
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[])
  return <div className="svx-order-edit-layer"><form className="svx-order-edit" role="dialog" aria-modal="true" aria-labelledby="svx-order-edit-title" onSubmit={save}>
    <header><div><small>TALÃO {order.code}</small><h2 id="svx-order-edit-title">Editar pedido</h2></div><button type="button" aria-label="Fechar edição" disabled={busy} onClick={()=>void close()}><X size={21}/></button></header>
    <div className="svx-order-edit__body">
      <p>Altere as quantidades e os preços, remova itens ou adicione produtos. O preço do catálogo não será alterado.</p>
      {lines.map((line,index)=><article key={line.key} className="svx-order-edit__item"><div className="svx-order-edit__item-head"><div><strong>{line.name}</strong><small>REF. {line.sku||'—'}</small></div><button type="button" aria-label={'Remover item '+(index+1)} disabled={busy} onClick={()=>setLines(prev=>prev.filter(item=>item.key!==line.key))}><Trash2 size={17}/></button></div>
        {line.product?(line.product.variations||[]).map(group=><label key={group.name}>{group.name}<select required value={line.selections[group.name]||''} disabled={busy} onChange={e=>chooseVariation(line,group.name,e.target.value)}><option value="">Selecione</option>{group.options.map(option=><option key={option}>{option}</option>)}</select></label>):<small>{Object.entries(line.selections).map(([k,v])=>k+': '+v).join(' · ')}</small>}
        <div className="svx-order-edit__fields"><label>Quantidade<input aria-label={'Quantidade do item '+(index+1)} type="number" min="1" max="999" step="1" required value={line.quantity} disabled={busy} onChange={e=>patch(line.key,{quantity:e.target.value})}/></label><label>Preço unitário (R$)<input aria-label={'Preço unitário do item '+(index+1)} type="number" min="0" max="9999999999.99" step=".01" required value={line.unitPrice} disabled={busy} onChange={e=>patch(line.key,{unitPrice:e.target.value})}/></label><div><small>Subtotal</small><strong>{money.format((Number(line.quantity)||0)*Math.round((Number(line.unitPrice)||0)*100)/100)}</strong></div></div>
      </article>)}
      {!lines.length&&<p>Adicione pelo menos um produto para salvar o pedido.</p>}
      <section className="svx-order-edit__add"><h3><Plus size={18}/> Adicionar produto</h3><label><Search size={16}/><input aria-label="Buscar produto para o pedido" placeholder="Nome ou referência" value={search} disabled={busy} onChange={e=>setSearch(e.target.value)}/></label>
        {searching&&<small role="status">Buscando produtos…</small>}{searchError&&<p role="alert">{searchError}</p>}
        {!searching&&search.trim()&&!results.length&&!searchError&&<small>Nenhum produto encontrado.</small>}
        {results.map(product=><button key={product.id} type="button" disabled={busy} onClick={()=>add(product)}><span><strong>{product.name}</strong><small>{product.sku}</small></span><b>{money.format(product.catalogPrice??product.price)}</b><Plus size={17}/></button>)}
      </section>
      {error&&<p role="alert" className="form-error">{error}</p>}
    </div>
    <footer><div><small>Total atualizado</small><strong>{money.format(total)}</strong></div><button type="button" className="secondary-action" disabled={busy} onClick={()=>void close()}>Cancelar</button><button className="primary-action" disabled={busy||!lines.length}>{busy?'Salvando…':'Salvar alterações'}</button></footer>
  </form></div>
}

type Props = { data: AdminBootstrap; onUpdated: () => void | Promise<void> }
const allowed = ['whatsapp','em_atendimento','confirmado','arquivado'] as const

export default function ShopvaxOrders({data,onUpdated}: Props) {
  const [query,setQuery] = useState('')
  const [status,setStatus] = useState('all')
  const [period,setPeriod] = useState('30')
  const [editing,setEditing]=useState<AdminOrder|null>(null)
  const [savedOrder,setSavedOrder]=useState<AdminOrder|null>(null)
  const [selected,setSelected] = useState<string | null>(null)
  const [busy,setBusy] = useState('')
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const sellerName = (sellerId?: string | null) => data.sellers.find((seller) => seller.id === sellerId)?.name || 'Loja'
  const since = period === 'all' ? 0 : Date.now()-Number(period)*86400000
  const displayedOrders=data.orders.map(o=>savedOrder?.id===o.id&&(savedOrder.edit_revision||0)>(o.edit_revision||0)?savedOrder:o)
  const orders = [...displayedOrders].filter(order => {
    const haystack = [order.code, sellerName(order.seller_id), order.buyer?.name, order.buyer?.city, order.buyer?.phone, ...order.items.flatMap(i=>[i.name,i.sku])].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase('pt-BR')))
      && (status === 'all' || order.status === status)
      && (!since || Date.parse(order.created_at)>=since)
  }).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))
  const active = displayedOrders.find(o=>o.id===selected) || null
  const update = async (order: AdminOrder, next: string) => {
    if (!(allowed as readonly string[]).includes(next) || next===order.status || busy) return
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
    if (!(await confirmAction(`Cancelar o talão ${order.code}? O estoque reservado será devolvido. Esta ação não pode ser desfeita.`, 'Cancelar talão', 'Cancelar e devolver estoque'))) return
    setError(''); setBusy(order.id)
    try {
      await api.cancelOrder(order.id)
      await onUpdated()
      setNotice(`Talão ${order.code} cancelado e estoque devolvido.`)
    } catch(err){setError(err instanceof Error?err.message:'Não foi possível cancelar o pedido.')}
    finally {setBusy('')}
  }
  const hideCancelled = async(order: AdminOrder) => {
    if (busy || order.status !== 'cancelled') return
    if (!(await confirmAction(`Apagar o talão cancelado ${order.code} do painel? Ele será ocultado das listagens, mas permanecerá registrado para auditoria. Esta ação não poderá ser desfeita no painel.`, 'Apagar talão cancelado', 'Apagar do painel'))) return
    setError(''); setBusy(order.id)
    try {
      await api.hideCancelledOrder(order.id)
      setSelected(null)
      await onUpdated()
      setNotice(`Talão ${order.code} apagado da listagem. Registro preservado para auditoria.`)
    } catch(err) { setError(err instanceof Error ? err.message : 'Não foi possível apagar o talão.') }
    finally { setBusy('') }
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
      <span><strong>{order.code}</strong><small>{date.format(new Date(order.created_at))}</small></span><span>{sellerName(order.seller_id)}<small>{order.items.reduce((n,i)=>n+i.quantity,0)} peça(s)</small></span><strong className={order.status==='cancelled'?'svx-orders__voided-value':''}>{money.format(order.total)}{order.status==='cancelled'&&<small>Não contabilizado</small>}</strong><span className="svx-orders__status">{statusText[order.status]||order.status}<ChevronRight size={14}/></span>
    </button>)}{!orders.length && <div className="svx-orders__empty"><ReceiptText size={27}/><strong>{data.orders.length?'Nenhum talão neste filtro.':'Nenhum pedido registrado ainda.'}</strong><p>{data.orders.length?'Ajuste os filtros para procurar outro pedido.':'Os pedidos preparados pelo catálogo aparecem aqui.'}</p></div>}</section>
    <aside className="svx-orders__detail">{active?<><div className="svx-orders__detail-top"><div><span className="svx-kicker">TALÃO DE PEDIDO</span><h2>{active.code}</h2></div><SVStamp>{active.status==='confirmado'?'CONFIRMADO':active.status==='cancelled'?'CANCELADO':'NA GRADE'}</SVStamp></div><div className="svx-orders__detail-meta"><span>Atendimento <strong>{sellerName(active.seller_id)}</strong></span><span>Registrado <strong>{date.format(new Date(active.created_at))}</strong></span></div>{(Boolean(active.buyer?.name || active.buyer?.city || active.buyer?.cep || active.buyer?.phone) || Boolean(active.notes?.trim())) && <section className="svx-orders__buyer" aria-label="Dados do comprador e observações"><span className="svx-kicker">COMPRADOR E ENTREGA</span><dl>{active.buyer?.name && <><dt>Nome</dt><dd>{active.buyer.name}</dd></>}{active.buyer?.phone && <><dt>Contato</dt><dd>{active.buyer.phone}</dd></>}{active.buyer?.city && <><dt>Cidade</dt><dd>{active.buyer.city}</dd></>}{active.buyer?.cep && <><dt>CEP</dt><dd>{active.buyer.cep}</dd></>}{active.notes?.trim() && <><dt>Observações</dt><dd>{active.notes}</dd></>}</dl></section>}<div className="svx-orders__items">{active.items.map((item,i)=><div className="svx-orders__item" key={i}><span className="svx-orders__item-n">{String(i+1).padStart(2,'0')}</span><div><strong>{item.name}</strong><small>REF. {item.sku||'—'}</small><p>{Object.entries(item.selections||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p><span>{item.quantity} × {money.format(item.unitPrice)}</span></div><strong>{money.format(item.lineTotal)}</strong></div>)}</div><div className="svx-orders__total"><span>{active.status==='cancelled'?'VALOR ORIGINAL · CANCELADO':'TOTAL DO TALÃO'}</span><strong className={active.status==='cancelled'?'svx-orders__voided-value':''}>{money.format(active.total)}</strong></div><div className="svx-orders__actions">{editable(active)&&<button className="svx-orders__edit" disabled={Boolean(busy)} onClick={()=>setEditing(active)}><Pencil size={16}/> Editar pedido</button>}<button onClick={()=>void copy(active)}><Clipboard size={16}/> Copiar talão</button><label>Andamento<select aria-label="Alterar estado do pedido" disabled={busy===active.id||active.status==='cancelled'} value={active.status} onChange={e=>void update(active,e.target.value)}><option value="whatsapp">Aguardando confirmação</option><option value="em_atendimento">Em atendimento</option><option value="confirmado">Venda confirmada</option><option value="arquivado">Arquivado</option>{active.status==='cancelled'&&<option value="cancelled">Cancelado</option>}</select></label>{active.status!=='cancelled'&&<button disabled={busy===active.id} className="svx-orders__cancel" onClick={()=>void cancel(active)}><XCircle size={16}/> Cancelar e devolver estoque</button>}{active.status==='cancelled'&&<button disabled={busy===active.id} className="svx-orders__delete" onClick={()=>void hideCancelled(active)}><Trash2 size={16}/> Apagar do painel</button>}</div></>:<div className="svx-orders__placeholder"><Package size={35}/><h2>Selecione um talão</h2><p>Confira grade, valores, vendedora e andamento do pedido sem sair do painel.</p><ArrowLeft size={17}/></div>}</aside></div>
    {editing&&<OrderEditor key={editing.id} order={editing} onClose={()=>setEditing(null)} onSaved={order=>{setSavedOrder(order);setEditing(null);setNotice('Talão '+order.code+' atualizado. Copie o resumo para compartilhar.');void Promise.resolve(onUpdated()).catch(()=>setError('Pedido salvo. Atualize o painel para consultar os dados mais recentes.'))}}/>}
  </div>
}
