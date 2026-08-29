import { useEffect, useState } from 'react'
import { ArrowLeft, BarChart3, Boxes, ExternalLink, Filter, Link2, ShoppingCart, Users } from 'lucide-react'
import './analytics-panel.css'

type ReportPayload = {
  periodDays: number
  interpretation: string
  items: Array<{ id: string; sku: string; name: string; views: number; clicks: number; cartAdds: number; whatsapp: number; whatsappUnits: number; interestRate: number }>
  links: Array<{ sellerId: string | null; name: string; slug: string; accesses: number; carts: number; checkouts: number; whatsapp: number }>
  sellers: Array<{ sellerId: string; name: string; slug: string; accesses: number; carts: number; checkouts: number; whatsapp: number; conversion: number }>
  catalogs: Array<{ catalogId: string | null; name: string; kind: string; slug: string; views: number; clicks: number; carts: number; whatsapp: number; engagement: number }>
  funnel: Array<{ key: string; label: string; value: number; fromPrevious: number; fromAccess: number }>
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const pct = (value: number) => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const num = (value: number) => Number(value || 0).toLocaleString('pt-BR')

async function loadReports(days: number) {
  const response = await fetch(`/api/admin/intent-reports?days=${days}`, { credentials: 'include' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar os relatórios.')
  return body as ReportPayload
}

export default function AnalyticsPanel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ReportPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    loadReports(days).then((result) => { if (active) setData(result) }).catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar relatórios.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days])

  return <div className="analytics-shell">
    <header className="analytics-head">
      <button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button>
      <div><span>Inteligência comercial</span><h1>Intenção até o WhatsApp</h1><p>O que realmente acontece entre a visita ao catálogo e o pedido enviado ao atendimento.</p></div>
      <label className="analytics-period"><Filter size={16}/><span>Período</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
    </header>

    {error && <div className="analytics-error">{error}</div>}
    {data?.interpretation && <div className="analytics-rule"><strong>Regra de leitura</strong><span>{data.interpretation}</span></div>}
    {loading && !data ? <div className="analytics-loading"><BarChart3 size={30}/><strong>Montando relatórios…</strong></div> : data && <>
      <section className="analytics-card">
        <div className="analytics-card__head"><div><Boxes size={19}/><span>1</span><h2>Performance dos itens</h2></div><p>Quais produtos despertam mais interesse.</p></div>
        <div className="analytics-table"><div className="analytics-row analytics-row--head analytics-row--items"><span>Produto</span><span>Views</span><span>Cliques</span><span>Carrinho</span><span>WhatsApp</span><span>Taxa de interesse</span></div>{data.items.map((item) => <div className="analytics-row analytics-row--items" key={item.id}><span><strong>{item.name}</strong><small>{item.sku || 'SEM SKU'}</small></span><span>{num(item.views)}</span><span>{num(item.clicks)}</span><span>{num(item.cartAdds)}</span><span>{num(item.whatsapp)}</span><span>{pct(item.interestRate)}</span></div>)}{!data.items.length && <p className="analytics-empty">Ainda não há interação suficiente com produtos neste período.</p>}</div>
      </section>

      <section className="analytics-card">
        <div className="analytics-card__head"><div><Link2 size={19}/><span>2</span><h2>Performance dos links</h2></div><p>Acessos e intenção gerados por cada link de atendimento.</p></div>
        <div className="analytics-table"><div className="analytics-row analytics-row--links analytics-row--head"><span>Link</span><span>Acessos</span><span>Carrinhos</span><span>Checkouts</span><span>WhatsApp</span></div>{data.links.map((item, index) => <div className="analytics-row analytics-row--links" key={`${item.sellerId || 'geral'}-${index}`}><span><strong>{item.name}</strong><small>{item.slug ? `/${item.slug}` : 'link geral da loja'}</small></span><span>{num(item.accesses)}</span><span>{num(item.carts)}</span><span>{num(item.checkouts)}</span><span>{num(item.whatsapp)}</span></div>)}</div>
      </section>

      <section className="analytics-card">
        <div className="analytics-card__head"><div><Users size={19}/><span>3</span><h2>Performance das vendedoras</h2></div><p>Resultado atribuível aos links individuais, sem tratar intenção como venda confirmada.</p></div>
        <div className="analytics-table"><div className="analytics-row analytics-row--links analytics-row--head"><span>Vendedora</span><span>Acessos</span><span>Carrinhos</span><span>WhatsApp</span><span>Conversão</span></div>{data.sellers.map((item) => <div className="analytics-row analytics-row--links" key={item.sellerId}><span><strong>{item.name}</strong><small>/{item.slug}</small></span><span>{num(item.accesses)}</span><span>{num(item.carts)}</span><span>{num(item.whatsapp)}</span><span>{pct(item.conversion)}</span></div>)}{!data.sellers.length && <p className="analytics-empty">Nenhuma vendedora com eventos atribuíveis no período.</p>}</div>
      </section>

      <section className="analytics-card">
        <div className="analytics-card__head"><div><ExternalLink size={19}/><span>4</span><h2>Performance dos catálogos</h2></div><p>Comparação entre atacado, varejo e outros catálogos ativos.</p></div>
        <div className="analytics-table"><div className="analytics-row analytics-row--catalogs analytics-row--head"><span>Catálogo</span><span>Views</span><span>Cliques</span><span>Carrinhos</span><span>WhatsApp</span><span>Engajamento</span></div>{data.catalogs.map((item, index) => <div className="analytics-row analytics-row--catalogs" key={`${item.catalogId || 'geral'}-${index}`}><span><strong>{item.name}</strong><small>{item.kind}</small></span><span>{num(item.views)}</span><span>{num(item.clicks)}</span><span>{num(item.carts)}</span><span>{num(item.whatsapp)}</span><span>{pct(item.engagement)}</span></div>)}</div>
      </section>

      <section className="analytics-card analytics-funnel-card">
        <div className="analytics-card__head"><div><ShoppingCart size={19}/><span>5</span><h2>Funil até o WhatsApp</h2></div><p>Onde o visitante avança ou abandona.</p></div>
        <div className="analytics-funnel">{data.funnel.map((stage, index) => <div key={stage.key} className="analytics-funnel__stage"><div><span>{index + 1}</span><strong>{stage.label}</strong></div><b>{num(stage.value)}</b><small>{index === 0 ? 'base do funil' : `${pct(stage.fromPrevious)} da etapa anterior · ${pct(stage.fromAccess)} dos acessos`}</small><div className="analytics-funnel__bar"><span style={{ width: `${Math.max(2, Math.min(100, stage.fromAccess))}%` }}/></div></div>)}</div>
      </section>
    </>}
  </div>
}
