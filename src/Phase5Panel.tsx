import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CreditCard, Gauge, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react'
import './phase5-panel.css'

type Status = {
  plan: { code: string; name: string; monthlyPrice: number; limits: { products: number | null; sellers: number | null; catalogs: number | null; franchisees: number | null; photosPerProduct: number | null } }
  usage: { products: number; sellers: number; catalogs: number; franchisees: number; ratios: Record<string, number | null> }
  billing: { status: string; cycle: string; periodStartedAt?: string | null; periodEndsAt?: string | null; graceEndsAt?: string | null; lastRenewedAt?: string | null; lastAmount: number; creditMonths: number; note: string }
  warnings: string[]
}

type Security = { sessions: { active: number; oldestAt?: string | null; latestExpiryAt?: string | null } }

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function limitText(current: number, max: number | null) {
  return max == null ? `${current} / ilimitado` : `${current} / ${max}`
}

function statusLabel(value: string) {
  return ({ active: 'Ativa', past_due: 'Em atraso', suspended: 'Suspensa', cancelled: 'Cancelada' } as Record<string, string>)[value] || value
}

export default function Phase5Panel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [security, setSecurity] = useState<Security | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [state, sessions] = await Promise.all([
        api<Status>('/api/admin/phase5/status'),
        api<Security>('/api/auth/security/sessions'),
      ])
      setStatus(state); setSecurity(sessions)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar assinatura e segurança.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const revokeOthers = async () => {
    if (!window.confirm('Encerrar todas as outras sessões da sua conta e manter apenas esta?')) return
    setBusy(true); setError('')
    try {
      const result = await api<{ revoked: number }>('/api/auth/security/revoke-others', { method: 'POST', body: '{}' })
      setNotice(`${result.revoked} sessão(ões) encerrada(s).`)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível encerrar as sessões.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="phase5-state"><RefreshCw className="phase5-spin" size={22}/> Carregando assinatura…</div>
  if (!status) return <div className="phase5-state phase5-state--error">{error || 'Informações indisponíveis.'}</div>

  const resources = [
    ['Produtos', status.usage.products, status.plan.limits.products, status.usage.ratios.products],
    ['Vendedoras', status.usage.sellers, status.plan.limits.sellers, status.usage.ratios.sellers],
    ['Catálogos', status.usage.catalogs, status.plan.limits.catalogs, status.usage.ratios.catalogs],
    ['Franqueados', status.usage.franchisees, status.plan.limits.franchisees, status.usage.ratios.franchisees],
  ] as const

  return <div className="phase5-panel">
    <header className="phase5-hero">
      <div><span>Conta</span><h1>Plano e uso</h1><p>Confira seu plano, limites de uso, créditos e sessões ativas.</p></div>
      <div className={`phase5-status phase5-status--${status.billing.status}`}><ShieldCheck size={18}/>{statusLabel(status.billing.status)}</div>
    </header>

    {notice && <div className="phase5-notice"><CheckCircle2 size={17}/>{notice}</div>}
    {error && <div className="phase5-error"><AlertTriangle size={17}/>{error}</div>}
    {status.warnings.length > 0 && <div className="phase5-warning"><AlertTriangle size={18}/><div>{status.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}

    <section className="phase5-grid phase5-grid--top">
      <article className="phase5-card">
        <div className="phase5-card__icon"><CreditCard size={20}/></div>
        <span>Plano atual</span><h2>{status.plan.name}</h2><strong>{brl.format(status.plan.monthlyPrice)}<small>/mês</small></strong>
      </article>
      <article className="phase5-card">
        <div className="phase5-card__icon"><CheckCircle2 size={20}/></div>
        <span>Créditos disponíveis</span><h2>{status.billing.creditMonths} mês(es)</h2><p>Créditos de indicação são consumidos na próxima renovação confirmada pela operação.</p>
      </article>
      <article className="phase5-card">
        <div className="phase5-card__icon"><Gauge size={20}/></div>
        <span>Período</span><h2>{status.billing.periodEndsAt ? `até ${date.format(new Date(status.billing.periodEndsAt))}` : 'Sem vencimento definido'}</h2><p>{status.billing.graceEndsAt ? `Tolerância até ${date.format(new Date(status.billing.graceEndsAt))}` : 'Ciclo operacional normal'}</p>
      </article>
    </section>

    <section className="phase5-section">
      <div className="phase5-section__head"><div><span>Plano</span><h2>Uso dos limites</h2></div><small>{status.plan.limits.photosPerProduct == null ? 'Fotos ilimitadas' : `${status.plan.limits.photosPerProduct} fotos por produto`}</small></div>
      <div className="phase5-resources">{resources.map(([label, current, max, ratio]) => <article key={label}>
        <div><strong>{label}</strong><span>{limitText(current, max)}</span></div>
        {ratio == null ? <div className="phase5-unlimited">Ilimitado</div> : <div className="phase5-meter"><span style={{ width: `${Math.min(100, ratio)}%` }}/><b>{ratio}%</b></div>}
      </article>)}</div>
    </section>

    <section className="phase5-section">
      <div className="phase5-section__head"><div><span>Segurança</span><h2>Sessões da conta</h2></div><KeyRound size={20}/></div>
      <div className="phase5-security-row"><div><strong>{security?.sessions.active ?? 1} sessão(ões) ativa(s)</strong><p>Se você não reconhecer outros acessos, encerre todas as outras sessões. Esta sessão continuará conectada.</p></div><button disabled={busy || (security?.sessions.active ?? 1) <= 1} onClick={() => void revokeOthers()}>{busy ? 'Encerrando…' : 'Encerrar outras sessões'}</button></div>
    </section>
  </div>
}
