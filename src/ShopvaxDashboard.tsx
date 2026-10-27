import { ArrowRight, Check, Clipboard, ExternalLink, Package, ReceiptText, Send, Users } from 'lucide-react'
import type { AdminBootstrap } from './types'
import { SVNumber, SVRibbon, SVStamp } from './ShopvaxDesignSystem'

type DeskSection = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'loja'
type Props = {
  data: AdminBootstrap
  incomplete: boolean
  storeUrl: string
  onSection: (section: DeskSection) => void
  onCopy: (url: string) => void
}
const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' })

/** Dashboard (prancha 06) com métricas exclusivamente provenientes do backend. */
export default function ShopvaxDashboard({ data, incomplete, storeUrl, onSection, onCopy }: Props) {
  const firstName = data.user.name.trim().split(/\s+/)[0] || 'lojista'
  const recent = [...data.orders].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,4)
  const activeSellers = data.sellers.filter(s=>s.is_active)
  const safeOrigin = new URL(storeUrl, window.location.href).origin
  const storeBase = `${safeOrigin}/${encodeURIComponent(data.store.slug)}`
  const statusName = (status: string) => ({
    whatsapp:'WhatsApp aberto',em_atendimento:'Em conversa',confirmado:'Confirmado',cancelled:'Cancelado',arquivado:'Arquivado'
  } as Record<string,string>)[status] || status
  const allItems = data.orders.reduce((n,order)=>n+order.items.reduce((subtotal,item)=>subtotal+item.quantity,0),0)
  const required = [
    { label:'WhatsApp e pedido mínimo', ready:Boolean(data.store.whatsapp),section:'loja' as DeskSection },
    { label:'Produtos cadastrados', ready:data.products.length>0,section:'produtos' as DeskSection },
    { label:'Vendedoras com link', ready:activeSellers.length>0,section:'vendedoras' as DeskSection },
  ]
  const completed = required.filter(x=>x.ready).length
  return <div className="panel-page svx-dashboard">
    <SVRibbon className="svx-dashboard__ribbon"><span>SHOPVAX · PAINEL DE QUEM VENDE</span><span>SEUS PEDIDOS NUM SÓ LUGAR</span></SVRibbon>
    <div className="svx-dashboard__welcome"><div><span className="svx-kicker">O BALCÃO ESTÁ ABERTO</span><h1>Boa tarde, {firstName}.</h1><p>{data.store.name} · {data.store.is_active ? 'Loja publicada' : 'Loja pausada'}</p></div><div className="svx-dashboard__welcome-actions"><a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir loja</a><button onClick={() => onSection('produtos')}><Package size={15}/> Produtos <ArrowRight size={15}/></button></div></div>
    <div className="svx-dashboard__metrics">
      <div className="svx-dashboard__primary-metric"><span className="svx-kicker">PEDIDOS REGISTRADOS</span><SVNumber value={data.stats.orders} label="no WhatsApp"/><SVStamp>EM MOVIMENTO</SVStamp></div>
      <div className="svx-dashboard__metric"><SVNumber value={data.stats.views} label="acessos à loja"/></div>
      <div className="svx-dashboard__metric"><SVNumber value={data.stats.carts} label="carrinhos iniciados"/></div>
      <div className="svx-dashboard__metric"><SVNumber value={allItems} label="peças em pedidos"/></div>
      <div className="svx-dashboard__metric"><strong>{money.format(data.stats.value)}</strong><small>valor registrado em pedidos, não faturamento confirmado</small></div>
    </div>
    <div className="svx-dashboard__columns"><section className="svx-dashboard__orders"><div className="svx-dashboard__section-heading"><div><span className="svx-kicker">ÚLTIMOS PEDIDOS</span><h2>Chegou no balcão</h2></div><button onClick={() => onSection('pedidos')}>Ver todos <ArrowRight size={15}/></button></div><div className="svx-dashboard__order-grid">{recent.map(order => <article key={order.id}><span className="svx-kicker">{order.code}</span><h3>{order.items[0]?.name || 'Pedido'}</h3><p>{order.items.reduce((sum,item)=>sum+item.quantity,0)} peças · {date.format(new Date(order.created_at))}</p><strong>{money.format(order.total)}</strong><small>{statusName(order.status)}</small></article>)}{!recent.length && <p className="svx-dashboard__empty">Ainda não chegaram pedidos. Compartilhe a loja para começar a receber solicitações.</p>}</div></section>
      <aside className="svx-dashboard__sidebar"><section className="svx-dashboard__links"><div className="svx-dashboard__section-heading"><h2>Seus links</h2><button onClick={() => onSection('vendedoras')}>Equipe <ArrowRight size={14}/></button></div><button className="svx-dashboard__link" onClick={() => onCopy(storeBase)}><span><strong>Link geral</strong><small>/{data.store.slug}</small></span><Clipboard size={16}/></button>{activeSellers.map(seller=><button key={seller.id} className="svx-dashboard__link" onClick={() => onCopy(`${storeBase}/${seller.slug}`)}><span><strong>{seller.name}</strong><small>/{data.store.slug}/{seller.slug}</small></span><Clipboard size={16}/></button>)}{!activeSellers.length && <button className="svx-dashboard__link" onClick={() => onSection('vendedoras')}><span><strong>Adicionar vendedora</strong><small>Cada vendedora terá seu link</small></span><Users size={16}/></button>}</section><section className="svx-dashboard__setup"><div className="svx-dashboard__section-heading"><h2>Loja pronta</h2><span>{completed} de {required.length}</span></div><div className="svx-dashboard__setup-track"><span style={{width:`${completed/required.length*100}%`}}/></div>{required.map((step,i)=><button key={step.label} onClick={() => onSection(step.section)}><span>{step.ready?<Check size={16}/>:i+1}</span><strong>{step.label}</strong><ArrowRight size={15}/></button>)}{!incomplete && <p className="svx-dashboard__ready"><Check size={14}/> Configuração essencial concluída.</p>}</section></aside></div>
    <div className="svx-dashboard__bottom"><Send size={16}/><span>Os links direcionam o comprador para a loja. Abrir o WhatsApp não confirma o envio ou pagamento de um pedido.</span></div>
  </div>
}
