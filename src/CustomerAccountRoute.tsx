import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, LogOut, PackageCheck, UserRound } from 'lucide-react'
import './customer-account.css'

type Customer = { id: string; name: string; email: string; phone: string }
type CustomerOrder = { id: string; code: string; total: number; status: string; created_at: string; seller_name?: string | null; items: Array<{ name?: string; quantity?: number }> }
type AccountPayload = {
  customer: Customer
  store: { slug: string; name: string; logoUrl?: string; accent?: string }
  orders: CustomerOrder[]
  semantics: string
}

type StoreConfig = {
  store: { slug: string; name: string; logoUrl?: string; accent?: string }
  customerLoginEnabled: boolean
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || 'Não foi possível concluir a operação.') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function statusLabel(value: string) {
  if (value === 'em_atendimento') return 'Em atendimento'
  if (value === 'arquivado') return 'Arquivado'
  if (value === 'cancelled') return 'Cancelado'
  return 'Enviado ao WhatsApp'
}

export default function CustomerAccountRoute() {
  const storeSlug = useMemo(() => window.location.pathname.split('/').filter(Boolean)[1] || '', [])
  const [config, setConfig] = useState<StoreConfig | null>(null)
  const [account, setAccount] = useState<AccountPayload | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadAccount = async () => {
    try {
      const result = await request<AccountPayload>(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/me`)
      setAccount(result)
      return true
    } catch (err) {
      const status = (err as Error & { status?: number }).status
      if (status !== 401) setError(err instanceof Error ? err.message : 'Não foi possível abrir sua conta.')
      setAccount(null)
      return false
    }
  }

  useEffect(() => {
    let mounted = true
    Promise.all([
      request<StoreConfig>(`/api/public/store/${encodeURIComponent(storeSlug)}/phase2-config`),
      loadAccount(),
    ]).then(([next]) => { if (mounted) setConfig(next) })
      .catch((err) => { if (mounted) setError(err instanceof Error ? err.message : 'Loja não encontrada.') })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [storeSlug])

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const endpoint = mode === 'login' ? 'login' : 'register'
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, phone: form.phone, password: form.password }
      await request(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/${endpoint}`, { method: 'POST', body: JSON.stringify(body) })
      await loadAccount()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  const logout = async () => {
    await request('/api/public/customers/logout', { method: 'POST' }).catch(() => undefined)
    setAccount(null)
    setMode('login')
  }

  if (loading) return <div className="customer-page"><div className="customer-card customer-loading"><UserRound size={28}/><strong>Abrindo sua conta…</strong></div></div>
  if (!config) return <div className="customer-page"><div className="customer-card"><h1>Loja não encontrada</h1><p>{error}</p></div></div>

  const accent = config.store.accent || '#c94c2d'
  return <div className="customer-page" style={{ '--customer-accent': accent } as React.CSSProperties}>
    <div className="customer-wrap">
      <button className="customer-back" onClick={() => go(`/${storeSlug}`)}><ArrowLeft size={17}/> Voltar para a loja</button>
      <header className="customer-store-head">{config.store.logoUrl ? <img src={config.store.logoUrl} alt=""/> : <span>SV</span>}<div><small>Conta do cliente</small><strong>{config.store.name}</strong></div></header>

      {!config.customerLoginEnabled ? <section className="customer-card"><h1>Conta de cliente indisponível</h1><p>Esta loja desativou temporariamente o acesso por conta.</p></section> : account ? <>
        <section className="customer-card customer-profile"><div><small>Olá,</small><h1>{account.customer.name}</h1><p>{account.customer.email}</p></div><button onClick={logout}><LogOut size={16}/> Sair</button></section>
        <section className="customer-card"><div className="customer-section-head"><div><small>Histórico</small><h2>Seus pedidos</h2></div><strong>{account.orders.length}</strong></div><p className="customer-semantics">{account.semantics}</p><div className="customer-orders">{account.orders.map((order) => <article key={order.id}><div className="customer-order-top"><div><small>{date.format(new Date(order.created_at))}</small><strong>{order.code}</strong></div><span className={`customer-status status-${order.status}`}><CheckCircle2 size={14}/>{statusLabel(order.status)}</span></div><div className="customer-order-info"><span>{order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(ns)</span><span>{order.seller_name ? `Atendimento: ${order.seller_name}` : 'Atendimento da loja'}</span><b>{money.format(order.total)}</b></div></article>)}{!account.orders.length && <div className="customer-empty"><PackageCheck size={30}/><strong>Nenhum pedido ainda.</strong><p>Quando você enviar um carrinho para o atendimento, ele aparecerá aqui.</p></div>}</div></section>
      </> : <section className="customer-card customer-auth">
        <div className="customer-tabs"><button className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>Entrar</button><button className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>Criar conta</button></div>
        <div><small>Cliente {config.store.name}</small><h1>{mode === 'login' ? 'Acesse seus pedidos' : 'Crie sua conta'}</h1><p>Use sua conta para acompanhar os pedidos registrados nesta loja.</p></div>
        {mode === 'register' && <label><span>Nome</span><input value={form.name} onChange={(e) => setForm((value) => ({ ...value, name: e.target.value }))} autoComplete="name"/></label>}
        <label><span>E-mail</span><input type="email" value={form.email} onChange={(e) => setForm((value) => ({ ...value, email: e.target.value }))} autoComplete="email"/></label>
        {mode === 'register' && <label><span>WhatsApp</span><input value={form.phone} onChange={(e) => setForm((value) => ({ ...value, phone: e.target.value }))} autoComplete="tel"/></label>}
        <label><span>Senha</span><input type="password" value={form.password} onChange={(e) => setForm((value) => ({ ...value, password: e.target.value }))} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>
        {error && <div className="customer-error">{error}</div>}
        <button className="customer-submit" disabled={busy} onClick={submit}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na conta' : 'Criar minha conta'}</button>
      </section>}
    </div>
  </div>
}
