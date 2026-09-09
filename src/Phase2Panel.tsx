import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Copy, Globe2, PackageCheck, Plus, RefreshCcw, Save, Trash2, UserRound, UsersRound } from 'lucide-react'
import './phase2-panel.css'

type Seller = { id: string; slug: string; name: string; phone: string; is_active: boolean }
type Franchisee = { id: string; slug: string; name: string; phone: string; active: boolean }
type Customer = { id: string; name: string; email: string; phone: string; active: boolean; orders_count: number; orders_value: number }
type Order = { id: string; code: string; total: number; status: string; created_at: string; customer_name?: string | null; customer_email?: string | null; seller_name?: string | null; items: Array<{ quantity?: number }> }
type Phase2Data = {
  plan: { code: string; name: string; limits: { sellers: number | null; franchisees: number | null }; features: Record<string, boolean> }
  store: {
    id: string
    slug: string
    sellerRotationCursor: number
    customerLoginEnabled: boolean
    customDomain: string
    customDomainStatus: string
    cnameTarget: string
    theme: { background: string; textColor: string; font: string; accent: string }
  }
  sellers: Seller[]
  franchisees: Franchisee[]
  customers: Customer[]
  orders: Order[]
  semantics: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function statusLabel(status: string) {
  if (status === 'em_atendimento') return 'Em atendimento'
  if (status === 'arquivado') return 'Arquivado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Enviado ao WhatsApp'
}

export default function Phase2Panel() {
  const [data, setData] = useState<Phase2Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [domain, setDomain] = useState('')
  const [background, setBackground] = useState('#ffffff')
  const [textColor, setTextColor] = useState('#17211b')
  const [font, setFont] = useState('system')
  const [customerLogin, setCustomerLogin] = useState(true)
  const [franchisee, setFranchisee] = useState({ name: '', phone: '' })

  const load = async () => {
    setError('')
    try {
      const next = await request<Phase2Data>('/api/admin/phase2')
      setData(next)
      setDomain(next.store.customDomain || '')
      setBackground(next.store.theme.background || '#ffffff')
      setTextColor(next.store.theme.textColor || '#17211b')
      setFont(next.store.theme.font || 'system')
      setCustomerLogin(next.store.customerLoginEnabled)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar a operação.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2400) }
  const sellerLimit = data?.plan.limits.sellers
  const franchiseeLimit = data?.plan.limits.franchisees
  const customDomainEnabled = data?.plan.features.customDomain === true
  const personalizationEnabled = data?.plan.features.storePersonalization === true
  const stockEnabled = data?.plan.features.stock === true
  const franchiseesEnabled = data?.plan.features.franchisees === true
  const activeSellers = useMemo(() => data?.sellers.filter((seller) => seller.is_active) || [], [data])

  const saveStore = async () => {
    if (!data) return
    setSaving('store'); setError('')
    try {
      const body: Record<string, unknown> = { customerLoginEnabled: customerLogin }
      if (customDomainEnabled) body.customDomain = domain
      if (personalizationEnabled) body.theme = { background, textColor, font }
      await request('/api/admin/phase2/store', { method: 'PATCH', body: JSON.stringify(body) })
      flash('Configurações operacionais atualizadas.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setSaving('') }
  }

  const addFranchisee = async () => {
    setSaving('franchisee'); setError('')
    try {
      await request('/api/admin/phase2/franchisees', { method: 'POST', body: JSON.stringify({ ...franchisee, active: true }) })
      setFranchisee({ name: '', phone: '' })
      flash('Franqueado cadastrado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cadastrar.') }
    finally { setSaving('') }
  }

  const removeFranchisee = async (item: Franchisee) => {
    if (!window.confirm(`Excluir ${item.name}?`)) return
    setSaving(item.id)
    try {
      await request(`/api/admin/phase2/franchisees/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      flash('Franqueado excluído.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir.') }
    finally { setSaving('') }
  }

  const setOrderStatus = async (order: Order, status: string) => {
    setSaving(order.id); setError('')
    try {
      await request(`/api/admin/phase2/orders/${encodeURIComponent(order.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      flash(`Pedido ${order.code} atualizado.`)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar o pedido.') }
    finally { setSaving('') }
  }

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    flash('Copiado.')
  }

  if (loading || !data) return <div className="phase2-shell"><div className="phase2-loading"><RefreshCcw size={24}/><strong>{loading ? 'Carregando Fase 2…' : 'Não foi possível abrir a operação.'}</strong>{error && <p>{error}</p>}</div></div>

  return <div className="phase2-shell">
    <div className="phase2-title"><div><span>Fase 2 · {data.plan.name}</span><h1>Operação da loja</h1><p>Equipe, clientes, domínio, estoque e acompanhamento dos pedidos em um único lugar.</p></div><button className="phase2-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></div>
    {notice && <div className="phase2-notice"><Check size={16}/>{notice}</div>}
    {error && <div className="phase2-error"><CircleAlert size={17}/>{error}</div>}

    <section className="phase2-card">
      <div className="phase2-card__head"><div><span>Intercalação automática</span><h2>Vendedoras</h2><p>O link geral alterna as vendedoras ativas em sequência. O link individual continua preso à própria vendedora.</p></div><strong>{activeSellers.length}{sellerLimit == null ? '' : ` / ${sellerLimit}`}</strong></div>
      <div className="phase2-sellers">{data.sellers.map((seller, index) => <article key={seller.id}><div className="phase2-avatar">{seller.name.slice(0, 2).toUpperCase()}</div><div><strong>{seller.name}</strong><span>{seller.is_active ? `Posição ${index + 1} no rodízio` : 'Fora do rodízio'}</span></div><button onClick={() => copy(`${window.location.origin}/${data.store.slug}/${seller.slug}`)}><Copy size={15}/> Link individual</button></article>)}</div>
      <div className="phase2-info"><UserRound size={17}/><span>Uma atribuição fica estável por 24 horas para o mesmo visitante, evitando trocar a vendedora no meio do carrinho.</span></div>
    </section>

    <section className="phase2-grid">
      <article className="phase2-card">
        <div className="phase2-card__head"><div><span>Cliente identificado</span><h2>Login e histórico</h2></div><strong>{data.customers.length}</strong></div>
        <label className="phase2-toggle"><input type="checkbox" checked={customerLogin} onChange={(event) => setCustomerLogin(event.target.checked)}/><span/> Permitir conta de cliente nesta loja</label>
        <p className="phase2-muted">Clientes autenticados passam a ter os próprios pedidos vinculados ao histórico da conta.</p>
        <div className="phase2-customer-list">{data.customers.slice(0, 12).map((customer) => <div key={customer.id}><div><strong>{customer.name}</strong><span>{customer.email}</span></div><b>{customer.orders_count} pedido(s)</b></div>)}{!data.customers.length && <p>Nenhum cliente criou conta ainda.</p>}</div>
      </article>

      <article className={`phase2-card ${!stockEnabled ? 'is-locked' : ''}`}>
        <div className="phase2-card__head"><div><span>Disponibilidade</span><h2>Estoque</h2></div><PackageCheck size={24}/></div>
        <p>{stockEnabled ? 'Seu plano pode controlar saldo geral e por grade. A baixa continua automática quando o pedido é criado.' : 'O Plano 1 não ativa controle de estoque. O recurso começa no Plano 2.'}</p>
        <button className="phase2-primary" disabled={!stockEnabled} onClick={() => go('/painel/recursos')}>Abrir controle de estoque</button>
      </article>
    </section>

    <section className={`phase2-card ${!franchiseesEnabled ? 'is-locked' : ''}`}>
      <div className="phase2-card__head"><div><span>Rede comercial</span><h2>Franqueados</h2><p>Cadastro separado das vendedoras. O rodízio do link geral continua exclusivo para vendedoras.</p></div><strong>{data.franchisees.length}{franchiseeLimit == null ? '' : ` / ${franchiseeLimit}`}</strong></div>
      {franchiseesEnabled ? <><div className="phase2-form-row"><input value={franchisee.name} onChange={(e) => setFranchisee((value) => ({ ...value, name: e.target.value }))} placeholder="Nome do franqueado"/><input value={franchisee.phone} onChange={(e) => setFranchisee((value) => ({ ...value, phone: e.target.value }))} placeholder="WhatsApp com DDD"/><button className="phase2-primary" disabled={saving === 'franchisee'} onClick={addFranchisee}><Plus size={16}/> Adicionar</button></div><div className="phase2-franchisees">{data.franchisees.map((item) => <div key={item.id}><UsersRound size={19}/><div><strong>{item.name}</strong><span>{item.phone}</span></div><button className="phase2-icon-danger" disabled={saving === item.id} onClick={() => removeFranchisee(item)}><Trash2 size={16}/></button></div>)}</div></> : <div className="phase2-lock-copy">Disponível a partir do Plano 2.</div>}
    </section>

    <section className="phase2-grid">
      <article className={`phase2-card ${!customDomainEnabled ? 'is-locked' : ''}`}>
        <div className="phase2-card__head"><div><span>Endereço próprio</span><h2>Domínio</h2></div><Globe2 size={23}/></div>
        <label className="phase2-field"><span>Domínio da loja</span><input disabled={!customDomainEnabled} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="loja.com.br"/></label>
        {customDomainEnabled ? <div className="phase2-domain-status"><b className={`status-${data.store.customDomainStatus}`}>{data.store.customDomainStatus === 'verified' ? 'Verificado' : data.store.customDomainStatus === 'pending' ? 'Aguardando DNS' : 'Não configurado'}</b>{data.store.cnameTarget && <span>CNAME → <code>{data.store.cnameTarget}</code> <button onClick={() => copy(data.store.cnameTarget)}><Copy size={13}/></button></span>}</div> : <p className="phase2-muted">Domínio próprio começa no Plano 2.</p>}
      </article>

      <article className={`phase2-card ${!personalizationEnabled ? 'is-locked' : ''}`}>
        <div className="phase2-card__head"><div><span>Identidade da loja</span><h2>Personalização avançada</h2></div></div>
        <div className="phase2-theme"><label><span>Fundo</span><input type="color" disabled={!personalizationEnabled} value={background} onChange={(e) => setBackground(e.target.value)}/></label><label><span>Texto</span><input type="color" disabled={!personalizationEnabled} value={textColor} onChange={(e) => setTextColor(e.target.value)}/></label><label><span>Fonte</span><select disabled={!personalizationEnabled} value={font} onChange={(e) => setFont(e.target.value)}><option value="system">Sistema</option><option value="rounded">Arredondada</option><option value="modern">Moderna</option><option value="serif">Serifada</option></select></label></div>
        {!personalizationEnabled && <p className="phase2-muted">Plano de fundo, fonte e cores avançadas começam no Plano 2. Logo, textos básicos e cor principal continuam na configuração da loja.</p>}
      </article>
    </section>

    <div className="phase2-save"><button className="phase2-primary" disabled={saving === 'store'} onClick={saveStore}><Save size={17}/>{saving === 'store' ? 'Salvando…' : 'Salvar configurações'}</button></div>

    <section className="phase2-card">
      <div className="phase2-card__head"><div><span>Acompanhamento</span><h2>Pedidos</h2><p>{data.semantics}</p></div><strong>{data.orders.length}</strong></div>
      <div className="phase2-orders"><div className="phase2-orders__head"><span>Pedido</span><span>Cliente</span><span>Vendedora</span><span>Quando</span><span>Valor do pedido</span><span>Status</span></div>{data.orders.map((order) => <div className="phase2-orders__row" key={order.id}><strong>{order.code}</strong><span>{order.customer_name || 'Sem login'}</span><span>{order.seller_name || 'Atendimento'}</span><span>{date.format(new Date(order.created_at))}</span><b>{money.format(order.total)}</b>{order.status === 'cancelled' ? <em>Cancelado</em> : <select disabled={saving === order.id} value={['whatsapp', 'em_atendimento', 'arquivado'].includes(order.status) ? order.status : 'whatsapp'} onChange={(e) => setOrderStatus(order, e.target.value)}><option value="whatsapp">Enviado ao WhatsApp</option><option value="em_atendimento">Em atendimento</option><option value="arquivado">Arquivado</option></select>}</div>)}</div>
      {!data.orders.length && <div className="phase2-empty">Os pedidos enviados ao WhatsApp aparecerão aqui.</div>}
    </section>
  </div>
}
