import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, KeyRound, RefreshCw, Search, ShieldCheck, Store, XCircle } from 'lucide-react'
import './platform-launch-ops.css'

type Check = { key: string; label: string; ok: boolean; critical: boolean }
type Billing = { status: string; cycle: string; periodEndsAt?: string | null; graceEndsAt?: string | null; lastAmount: number; creditMonths: number; note: string }
type StoreRow = {
  id: string; slug: string; name: string; isActive: boolean; planCode: string; planName: string; monthlyPrice: number; ownerName: string; ownerEmail: string
  billing: Billing; products: number; sellers: number; catalogs: number; ownerSessions: number; customerSessions: number
}
type Overview = {
  launchReady: boolean
  checks: Check[]
  stats: { stores: number; billing_active: number; billing_past_due: number; billing_suspended: number; billing_cancelled: number; expires_7d: number; expires_30d: number; active_owner_sessions: number; active_customer_sessions: number; failed_erp_24h: number; risky_payments_30d: number }
  stores: StoreRow[]
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function billingLabel(status: string) {
  return ({ active: 'Ativa', past_due: 'Em atraso', suspended: 'Suspensa', cancelled: 'Cancelada' } as Record<string, string>)[status] || status
}

export default function PlatformLaunchOps() {
  const [data, setData] = useState<Overview | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    setError('')
    try { setData(await api<Overview>('/api/platform/phase5/overview')) }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível abrir a homologação.') }
  }
  useEffect(() => { void load() }, [])

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3000) }
  const password = () => window.prompt('Confirme sua senha administrativa para esta ação:') || ''

  const run = async (key: string, path: string, body: Record<string, unknown>, success: string) => {
    const pass = password()
    if (!pass) return
    setBusy(key); setError('')
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ ...body, password: pass }) })
      flash(success); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Operação não concluída.') }
    finally { setBusy('') }
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!data || !term) return data?.stores || []
    return data.stores.filter((store) => `${store.name} ${store.slug} ${store.ownerName} ${store.ownerEmail} ${store.planCode} ${store.billing.status}`.toLowerCase().includes(term))
  }, [data, query])

  if (!data) return <div className="launchops-state"><RefreshCw size={20}/>{error || 'Carregando homologação…'}</div>

  return <div className="launchops-shell">
    <header className="launchops-topbar"><button onClick={() => go('/admin')}><ArrowLeft size={18}/> Administração</button><div><span>Shopvax</span><strong>Fechamento para lançamento</strong></div><button onClick={() => void load()}><RefreshCw size={17}/> Atualizar</button></header>
    <main className="launchops-main">
      {notice && <div className="launchops-notice"><CheckCircle2 size={17}/>{notice}</div>}
      {error && <div className="launchops-error"><AlertTriangle size={17}/>{error}</div>}

      <section className="launchops-hero">
        <div><span>Fase 5</span><h1>Homologação operacional</h1><p>Billing, sessões, segurança e dependências críticas antes do lançamento.</p></div>
        <div className={`launchops-ready ${data.launchReady ? 'is-ready' : ''}`}>{data.launchReady ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}<div><small>Status crítico</small><strong>{data.launchReady ? 'Pronto' : 'Pendências'}</strong></div></div>
      </section>

      <section className="launchops-checks">{data.checks.map((check) => <article className={check.ok ? 'is-ok' : 'is-fail'} key={check.key}>{check.ok ? <CheckCircle2 size={19}/> : <XCircle size={19}/>}<div><strong>{check.label}</strong><small>{check.critical ? 'Obrigatório' : 'Recomendado'}</small></div></article>)}</section>

      <section className="launchops-metrics">
        <article><Store size={18}/><span>Lojas</span><strong>{data.stats.stores}</strong></article>
        <article><CreditCard size={18}/><span>Ativas</span><strong>{data.stats.billing_active}</strong></article>
        <article><AlertTriangle size={18}/><span>Em atraso</span><strong>{data.stats.billing_past_due}</strong></article>
        <article><ShieldCheck size={18}/><span>Suspensas</span><strong>{data.stats.billing_suspended}</strong></article>
        <article><KeyRound size={18}/><span>Sessões</span><strong>{Number(data.stats.active_owner_sessions || 0) + Number(data.stats.active_customer_sessions || 0)}</strong></article>
        <article><AlertTriangle size={18}/><span>ERP falhou 24h</span><strong>{data.stats.failed_erp_24h}</strong></article>
      </section>

      <section className="launchops-section">
        <div className="launchops-section__head"><div><span>Operação</span><h2>Lojas e cobrança</h2></div><label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar loja, dono, plano ou status"/></label></div>
        <div className="launchops-stores">{filtered.map((store) => <article key={store.id}>
          <div className="launchops-store__title"><div><span className={`launchops-badge launchops-badge--${store.billing.status}`}>{billingLabel(store.billing.status)}</span><h3>{store.name}</h3><small>{store.ownerName} · {store.ownerEmail}</small></div><div><strong>{store.planName || store.planCode}</strong><small>{money.format(store.monthlyPrice)}/mês</small></div></div>
          <div className="launchops-store__facts">
            <span><b>{store.products}</b> produtos</span><span><b>{store.sellers}</b> vendedoras</span><span><b>{store.catalogs}</b> catálogos</span><span><b>{store.billing.creditMonths}</b> crédito(s)</span><span><b>{store.ownerSessions + store.customerSessions}</b> sessões</span><span><b>{store.billing.periodEndsAt ? date.format(new Date(store.billing.periodEndsAt)) : '—'}</b> vencimento</span>
          </div>
          <div className="launchops-store__actions">
            <button disabled={Boolean(busy)} onClick={() => void run(`${store.id}-m`, `/api/platform/phase5/stores/${store.id}/billing/renew`, { cycle: 'monthly', useCredits: true }, 'Renovação mensal registrada.')}>Renovar 1 mês</button>
            <button disabled={Boolean(busy)} onClick={() => void run(`${store.id}-s`, `/api/platform/phase5/stores/${store.id}/billing/renew`, { cycle: 'semester', useCredits: true }, 'Renovação semestral registrada.')}>6 meses</button>
            <button disabled={Boolean(busy)} onClick={() => void run(`${store.id}-a`, `/api/platform/phase5/stores/${store.id}/billing/renew`, { cycle: 'annual', useCredits: true }, 'Renovação anual registrada.')}>12 meses</button>
            <button disabled={Boolean(busy)} onClick={() => void run(`${store.id}-c`, `/api/platform/phase5/stores/${store.id}/billing/credits`, { months: 1, note: 'Ajuste operacional' }, 'Crédito adicionado.')}>+1 crédito</button>
            {store.billing.status === 'active' ? <button className="is-warn" disabled={Boolean(busy)} onClick={() => void run(`${store.id}-p`, `/api/platform/phase5/stores/${store.id}/billing/status`, { status: 'past_due', graceDays: 7 }, 'Loja marcada em atraso.')}>Marcar atraso</button> : <button disabled={Boolean(busy)} onClick={() => void run(`${store.id}-ok`, `/api/platform/phase5/stores/${store.id}/billing/status`, { status: 'active' }, 'Cobrança reativada.')}>Reativar cobrança</button>}
            <button className="is-danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Suspender a cobrança e a loja ${store.name}?`)) void run(`${store.id}-x`, `/api/platform/phase5/stores/${store.id}/billing/status`, { status: 'suspended' }, 'Loja suspensa por cobrança.') }}>Suspender</button>
            <button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Encerrar todas as sessões de ${store.name}?`)) void run(`${store.id}-r`, `/api/platform/phase5/stores/${store.id}/security/revoke-sessions`, { scope: 'all' }, 'Sessões revogadas.') }}>Revogar sessões</button>
          </div>
        </article>)}</div>
      </section>
    </main>
  </div>
}
