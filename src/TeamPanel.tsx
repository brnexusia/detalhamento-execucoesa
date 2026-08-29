import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, RefreshCcw, Save, ShieldCheck, Users } from 'lucide-react'
import './team-panel.css'

type TeamSeller = {
  id: string
  slug: string
  name: string
  phone: string
  active: boolean
  role: 'gerente' | 'vendedora'
  commissionType: 'none' | 'percent' | 'fixed'
  commissionValue: number
  metrics: {
    accesses: number
    cartAdds: number
    whatsappOrders: number
    attributedOrders: number
    attributedValue: number
    estimatedCommission: number
  }
}

type TeamPayload = {
  administrator: { id: string; name: string; email: string; role: 'administrador' }
  storeSlug: string
  interpretation: string
  sellers: TeamSeller[]
}

type Draft = { role: 'gerente' | 'vendedora'; commissionType: 'none' | 'percent' | 'fixed'; commissionValue: string }

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'Não foi possível concluir a operação.')
  return body as T
}

export default function TeamPanel() {
  const [data, setData] = useState<TeamPayload | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const result = await request<TeamPayload>('/api/admin/team')
      setData(result)
      setDrafts(Object.fromEntries(result.sellers.map((seller) => [seller.id, {
        role: seller.role,
        commissionType: seller.commissionType,
        commissionValue: String(seller.commissionValue || ''),
      }])))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar a equipe.') }
  }

  useEffect(() => { void load() }, [])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const save = async (seller: TeamSeller) => {
    const draft = drafts[seller.id]
    if (!draft) return
    setSaving(seller.id); setError('')
    try {
      const result = await request<TeamPayload>(`/api/admin/team/sellers/${encodeURIComponent(seller.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: draft.role, commissionType: draft.commissionType, commissionValue: Number(draft.commissionValue || 0) }),
      })
      setData(result)
      setDrafts(Object.fromEntries(result.sellers.map((item) => [item.id, { role: item.role, commissionType: item.commissionType, commissionValue: String(item.commissionValue || '') }])))
      flash(`Equipe de ${seller.name} atualizada.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a equipe.') }
    finally { setSaving('') }
  }

  const copyLink = async (seller: TeamSeller) => {
    if (!data) return
    await navigator.clipboard.writeText(`${window.location.origin}/${data.storeSlug}/${seller.slug}`)
    flash(`Link de ${seller.name} copiado.`)
  }

  if (!data) return <div className="team-shell"><div className="team-loading"><Users size={30}/><strong>Carregando equipe…</strong>{error && <p>{error}</p>}</div></div>

  return <div className="team-shell">
    <header className="team-head">
      <button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button>
      <div><span>Equipe de vendas</span><h1>Papéis e comissão</h1><p>Estrutura operacional simples para acompanhar origem, intenção e estimativa por vendedora.</p></div>
      <button className="team-refresh" onClick={load}><RefreshCcw size={16}/> Atualizar</button>
    </header>

    {notice && <div className="team-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="team-error">{error}</div>}
    <div className="team-rule"><ShieldCheck size={20}/><div><strong>Regra de interpretação</strong><p>{data.interpretation}</p></div></div>

    <section className="team-card team-admin">
      <div><span>Administrador</span><h2>{data.administrator.name}</h2><p>{data.administrator.email}</p></div>
      <div className="team-admin__badge">Controle total da conta</div>
    </section>

    <section className="team-card">
      <div className="team-card__head"><div><span>Módulo 5</span><h2>Equipe comercial</h2></div><p>Gerente acompanha operação e relatórios. Vendedora trabalha com seus links e pedidos atribuíveis.</p></div>
      <div className="team-list">{data.sellers.map((seller) => {
        const draft = drafts[seller.id] || { role: seller.role, commissionType: seller.commissionType, commissionValue: String(seller.commissionValue || '') }
        return <article className="team-member" key={seller.id}>
          <div className="team-member__identity"><div><span>{seller.active ? 'Ativa' : 'Inativa'}</span><h3>{seller.name}</h3><small>/{seller.slug}</small></div><button onClick={() => copyLink(seller)}><Copy size={15}/> Copiar link</button></div>
          <div className="team-member__settings">
            <label><span>Papel</span><select value={draft.role} onChange={(e) => setDrafts((current) => ({ ...current, [seller.id]: { ...draft, role: e.target.value as Draft['role'] } }))}><option value="vendedora">Vendedora</option><option value="gerente">Gerente</option></select></label>
            <label><span>Comissão</span><select value={draft.commissionType} onChange={(e) => setDrafts((current) => ({ ...current, [seller.id]: { ...draft, commissionType: e.target.value as Draft['commissionType'] } }))}><option value="none">Sem comissão</option><option value="percent">Percentual</option><option value="fixed">Valor fixo por pedido</option></select></label>
            <label><span>{draft.commissionType === 'percent' ? 'Percentual (%)' : draft.commissionType === 'fixed' ? 'Valor por pedido' : 'Valor'}</span><input type="number" min="0" max={draft.commissionType === 'percent' ? 100 : undefined} step="0.01" disabled={draft.commissionType === 'none'} value={draft.commissionValue} onChange={(e) => setDrafts((current) => ({ ...current, [seller.id]: { ...draft, commissionValue: e.target.value } }))}/></label>
          </div>
          <div className="team-metrics">
            <div><span>Acessos</span><strong>{seller.metrics.accesses.toLocaleString('pt-BR')}</strong></div>
            <div><span>Carrinhos</span><strong>{seller.metrics.cartAdds.toLocaleString('pt-BR')}</strong></div>
            <div><span>Pedidos enviados ao WhatsApp</span><strong>{seller.metrics.attributedOrders.toLocaleString('pt-BR')}</strong></div>
            <div><span>Base de intenção atribuível</span><strong>{money.format(seller.metrics.attributedValue)}</strong></div>
            <div className="team-metric--commission"><span>Comissão estimada</span><strong>{money.format(seller.metrics.estimatedCommission)}</strong></div>
          </div>
          <div className="team-member__footer"><small>Estimativa operacional — não é folha, repasse ou faturamento confirmado.</small><button disabled={saving === seller.id} onClick={() => save(seller)}><Save size={16}/>{saving === seller.id ? 'Salvando…' : 'Salvar'}</button></div>
        </article>
      })}{!data.sellers.length && <div className="team-empty">Cadastre vendedoras no painel para configurar papéis e comissão.</div>}</div>
    </section>
  </div>
}
