import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, LogOut, PackageCheck, UserRound } from 'lucide-react'
import { apiRequest } from './api'
import BuyerWhatsappLogin from './BuyerWhatsappLogin'
import './customer-account.css'
import { listenAuthChanges } from './auth-session-sync'

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
  buyerWhatsAppLoginEnabled?: boolean
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })

function customerStoreSlug() {
  return window.location.pathname.split('/').filter(Boolean)[1] || ''
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function statusLabel(value: string) {
  if (value === 'whatsapp') return 'Pedido preparado'
  if (value === 'em_atendimento') return 'Em atendimento'
  if (value === 'confirmado') return 'Confirmado pela loja'
  if (value === 'arquivado') return 'Arquivado'
  if (value === 'cancelled') return 'Cancelado'
  return 'Status em atualização'
}

function statusExplanation(value: string) {
  if (value === 'whatsapp') return 'Talão registrado. Abrir o WhatsApp não confirma que a mensagem foi enviada.'
  if (value === 'em_atendimento') return 'A loja marcou este pedido como em atendimento.'
  if (value === 'confirmado') return 'Confirmação manual da loja; não significa pagamento recebido.'
  if (value === 'arquivado') return 'Talão arquivado pela loja. Consulte a vendedora para detalhes.'
  if (value === 'cancelled') return 'Pedido cancelado. Estoque devolvido quando aplicável.'
  return 'Consulte a loja para verificar a situação deste talão.'
}

export default function CustomerAccountRoute() {
  const [storeSlug, setStoreSlug] = useState(customerStoreSlug)
  const [config, setConfig] = useState<StoreConfig | null>(null)
  const [account, setAccount] = useState<AccountPayload | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const accountVersion = useRef(0)
  const next = new URLSearchParams(window.location.search).get('next') || ''
  const safeProfileNext = next === `/perfil/${encodeURIComponent(storeSlug)}` ? next : ''

  // A rota de conta permanece montada quando o SPA muda entre /cliente/loja-a e /cliente/loja-b.
  useEffect(() => {
    const onRoute = () => setStoreSlug(customerStoreSlug())
    window.addEventListener('popstate', onRoute)
    return () => window.removeEventListener('popstate', onRoute)
  }, [])

  const loadAccount = async () => {
    const version = ++accountVersion.current
    try {
      const result = await apiRequest<AccountPayload>(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/me`)
      if (version === accountVersion.current) { setAccount(result); setError('') }
      return true
    } catch (err) {
      const status = (err as Error & { status?: number }).status
      if (version === accountVersion.current) {
        if (status !== 401) setError(err instanceof Error ? err.message : 'Não foi possível abrir sua conta.')
        setAccount(null)
      }
      return false
    }
  }

  useEffect(() => {
    let mounted = true
    accountVersion.current += 1
    setConfig(null)
    setAccount(null)
    setError('')
    setLoading(true)
    setForm({ email: '', password: '' })
    Promise.all([
      apiRequest<StoreConfig>(`/api/public/store/${encodeURIComponent(storeSlug)}/phase2-config`),
      loadAccount(),
    ]).then(([next]) => { if (mounted) setConfig(next) })
      .catch((err) => { if (mounted) setError(err instanceof Error ? err.message : 'Loja não encontrada.') })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false; accountVersion.current += 1 }
  }, [storeSlug])

  useEffect(() => {
    const revalidate = () => { setAccount(null); void loadAccount() }
    const unsubscribe = listenAuthChanges('customer', revalidate)
    const onFocus = () => { if (document.visibilityState === 'visible') revalidate() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [storeSlug])

  const submit = async () => {
    setBusy(true); setError('')
    try {
      // Somente contas antigas usam a compatibilidade e-mail/senha.
      await apiRequest(`/api/public/store/${encodeURIComponent(storeSlug)}/customers/login`, {
        method: 'POST', body: JSON.stringify({ email: form.email, password: form.password }),
      })
      await completeBuyerEntry()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  const completeBuyerEntry = async () => {
    const ok = await loadAccount()
    if (ok && safeProfileNext) go(safeProfileNext)
    return ok
  }

  const logout = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      // Só descartar o estado depois de o servidor confirmar a revogação.
      await apiRequest('/api/public/customers/logout', { method: 'POST' })
      accountVersion.current += 1
      setAccount(null)
      setForm({ email: '', password: '' })
      setLegacyOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível sair. Verifique a conexão e tente novamente.')
    } finally { setBusy(false) }
  }

  if (loading || storeSlug !== customerStoreSlug() || (config && config.store.slug !== storeSlug)) return <div className="customer-page"><div className="customer-card customer-loading"><UserRound size={28}/><strong>Abrindo sua conta…</strong></div></div>
  if (!config) return <div className="customer-page"><div className="customer-card"><h1>Loja não encontrada</h1><p>{error}</p></div></div>

  const accent = config.store.accent || '#F25C05'
  return <div className="customer-page" style={{ '--customer-accent': accent } as React.CSSProperties}>
    <div className="customer-wrap">
      <button className="customer-back" onClick={() => go(safeProfileNext || `/${storeSlug}`)}><ArrowLeft size={17}/> {safeProfileNext ? 'Voltar ao perfil da loja' : 'Voltar para a loja'}</button>
      <header className="customer-store-head">{config.store.logoUrl ? <img src={config.store.logoUrl} alt=""/> : <span>SV</span>}<div><small>Conta do cliente</small><strong>{config.store.name}</strong></div></header>

      {!config.customerLoginEnabled ? <section className="customer-card"><h1>Conta de cliente indisponível</h1><p>Esta loja desativou temporariamente o acesso por conta.</p></section> : account ? <>
        <section className="customer-card customer-profile"><div><small>Olá,</small><h1>{account.customer.name}</h1><p>{account.customer.email}</p></div><button disabled={busy} onClick={logout}><LogOut size={16}/> {busy ? 'Saindo…' : 'Sair'}</button></section>{error && <div className="customer-error" role="alert">{error}</div>}
        {config.buyerWhatsAppLoginEnabled && <BuyerWhatsappLogin key={storeSlug + "-profile"} storeSlug={storeSlug} editOnly onVerified={loadAccount}/>}
        <section className="customer-card"><div className="customer-section-head"><div><small>Histórico</small><h2>Seus pedidos</h2></div><strong>{account.orders.length}</strong></div><p className="customer-semantics">{account.semantics}</p><div className="customer-orders">{account.orders.map((order) => <article key={order.id}><div className="customer-order-top"><div><small>{date.format(new Date(order.created_at))}</small><strong>{order.code}</strong></div><span className={`customer-status status-${order.status}`}><CheckCircle2 size={14}/>{statusLabel(order.status)}</span></div><div className="customer-order-info"><span>{(() => { const total = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0); return `${total} ${total === 1 ? 'item' : 'itens'}` })()}</span><span>{order.seller_name ? `Atendimento: ${order.seller_name}` : 'Atendimento da loja'}</span><b>{money.format(order.total)}</b></div><p className="customer-order-explanation">{statusExplanation(order.status)}</p></article>)}{!account.orders.length && <div className="customer-empty"><PackageCheck size={30}/><strong>Nenhum pedido ainda.</strong><p>Quando você preparar um pedido nesta loja com sua conta, ele aparecerá aqui.</p></div>}</div></section>
      </> : <div className="buyer-auth-entry">
        <BuyerWhatsappLogin key={storeSlug} storeSlug={storeSlug} enabled={config.buyerWhatsAppLoginEnabled === true} onVerified={completeBuyerEntry}/>
        {!config.buyerWhatsAppLoginEnabled && <div className="customer-legacy-access">
          <button type="button" className="customer-legacy-toggle" aria-expanded={legacyOpen}
            onClick={() => setLegacyOpen((value) => !value)}>
            {legacyOpen ? 'Fechar acesso à conta antiga' : 'Já tinha conta com e-mail?'}
          </button>
          {legacyOpen && <section className="customer-card customer-auth">
            <div><small>Acesso antigo</small><h2>Entrar na conta existente</h2>
              <p>Somente para clientes que já usavam e-mail e senha. O novo cadastro de comprador é feito por WhatsApp.</p></div>
            <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <label><span>E-mail</span><input type="email" required value={form.email}
                onChange={(e) => setForm((value) => ({ ...value, email: e.target.value }))} autoComplete="email"/></label>
              <label><span>Senha antiga</span><input type="password" required value={form.password}
                onChange={(e) => setForm((value) => ({ ...value, password: e.target.value }))} autoComplete="current-password"/></label>
              {error && <div className="customer-error" role="alert">{error}</div>}
              <button type="submit" className="customer-submit" disabled={busy}>{busy ? 'Aguarde…' : 'Entrar na conta antiga'}</button>
            </form>
          </section>}
        </div>}
      </div>}
    </div>
  </div>
}
