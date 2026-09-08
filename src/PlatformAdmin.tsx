import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileClock,
  LogOut,
  Package,
  Pencil,
  ReceiptText,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'

type PlatformStats = { users: number; stores: number; active_stores: number; products: number; orders: number; order_value: number }
type PlatformPlan = {
  id: string; code: string; name: string; monthlyPrice: number; semesterDiscount: number; annualDiscount: number
  sellerLimit: number | null; productLimit: number | null; catalogLimit: number | null; socialWeight: number; active: boolean; isSystem: boolean
  createdAt: string; updatedAt: string
}
type PlatformStore = {
  id: string; slug: string; name: string; isActive: boolean; createdAt: string; ownerId: string; ownerName: string; ownerEmail: string
  planCode: string; products: number; sellers: number; orders: number; orderValue: number
}
type PlatformAdminUser = { id: string; name: string; email: string; createdAt: string; hasStore: boolean }
type LatestUser = { id: string; name: string; email: string; createdAt: string; storeName?: string | null; storeSlug?: string | null }
type AuditEntry = { id: string; action: string; targetType: string; targetId?: string | null; meta: Record<string, unknown>; createdAt: string; actorName?: string | null; actorEmail?: string | null }
type PlatformAccount = { id: string; name: string; email: string; createdAt: string; isAdmin: boolean; store: null | { id: string; name: string; slug: string; isActive: boolean; planCode: string } }
type Bootstrap = {
  user: { id: string; name: string; email: string }; stats: PlatformStats; stores: PlatformStore[]; admins: PlatformAdminUser[]
  latestUsers: LatestUser[]; plans: PlatformPlan[]; audit: AuditEntry[]
}
type Section = 'visao' | 'lojas' | 'contas' | 'planos' | 'admins' | 'auditoria'

type DangerTarget =
  | { kind: 'account'; id: string; name: string }
  | { kind: 'admin'; id: string; name: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function limitLabel(value: number | null, suffix: string) { return value == null ? `${suffix} ilimitados` : `${value.toLocaleString('pt-BR')} ${suffix}` }
function semesterPrice(plan: PlatformPlan) { return plan.monthlyPrice * 6 * (1 - plan.semesterDiscount / 100) }
function annualPrice(plan: PlatformPlan) { return plan.monthlyPrice * 12 * (1 - plan.annualDiscount / 100) }
function actionLabel(action: string) {
  return ({
    'store.activate': 'Loja reativada', 'store.suspend': 'Loja suspensa', 'store.plan.change': 'Plano alterado',
    'plan.create': 'Plano criado', 'plan.update': 'Plano editado', 'plan.delete': 'Plano apagado',
    'admin.add': 'Administrador adicionado', 'admin.remove': 'Administrador removido', 'admin.claim': 'Admin inicial ativado',
    'account.delete': 'Conta apagada',
  } as Record<string, string>)[action] || action
}

export default function PlatformAdmin() {
  const [section, setSection] = useState<Section>('visao')
  const [data, setData] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [storeQuery, setStoreQuery] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState<PlatformPlan | 'new' | null>(null)
  const [danger, setDanger] = useState<DangerTarget | null>(null)
  const [claimToken, setClaimToken] = useState('')
  const [claiming, setClaiming] = useState(false)

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await request<Bootstrap>('/api/platform/bootstrap')) }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível abrir o administrativo.') }
    finally { setLoading(false) }
  }

  const loadAccounts = async () => {
    setAccountsLoading(true)
    try {
      const q = accountQuery.trim() ? `?q=${encodeURIComponent(accountQuery.trim())}&limit=100` : '?limit=100'
      const result = await request<{ accounts: PlatformAccount[] }>(`/api/platform/accounts${q}`)
      setAccounts(result.accounts)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar as contas.') }
    finally { setAccountsLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { if (data && section === 'contas') void loadAccounts() }, [section, data])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined)
    go('/entrar?next=/admin')
  }

  const claimAdmin = async (event: React.FormEvent) => {
    event.preventDefault(); setClaiming(true); setError('')
    try { await request('/api/platform/claim-admin', { method: 'POST', body: JSON.stringify({ token: claimToken }) }); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível ativar o primeiro administrador.') }
    finally { setClaiming(false) }
  }

  const toggleStore = async (store: PlatformStore) => {
    try {
      await request(`/api/platform/stores/${store.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: !store.isActive }) })
      flash(store.isActive ? 'Loja suspensa.' : 'Loja reativada.'); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a loja.') }
  }

  const setStorePlan = async (store: PlatformStore, planCode: string) => {
    try {
      await request(`/api/platform/stores/${store.id}/plan`, { method: 'PATCH', body: JSON.stringify({ planCode }) })
      flash(`Plano da ${store.name} atualizado.`); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível alterar o plano.') }
  }

  const deletePlan = async (plan: PlatformPlan) => {
    if (plan.isSystem || !window.confirm(`Apagar o plano ${plan.name}?`)) return
    try { await request(`/api/platform/plans/${plan.id}`, { method: 'DELETE' }); flash('Plano apagado.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível apagar o plano.') }
  }

  const executeDanger = async (password: string) => {
    if (!danger) return
    const path = danger.kind === 'account' ? `/api/platform/accounts/${danger.id}` : `/api/platform/admins/${danger.id}`
    await request(path, { method: 'DELETE', body: JSON.stringify({ password }) })
    const kind = danger.kind
    setDanger(null); flash(kind === 'account' ? 'Conta apagada.' : 'Administrador removido.')
    await load()
    if (kind === 'account') await loadAccounts()
  }

  const filteredStores = useMemo(() => {
    if (!data) return []
    const term = storeQuery.trim().toLowerCase()
    if (!term) return data.stores
    return data.stores.filter((store) => `${store.name} ${store.slug} ${store.ownerName} ${store.ownerEmail} ${store.planCode}`.toLowerCase().includes(term))
  }, [data, storeQuery])

  if (loading) return <div className="platform-loading"><span className="platform-mark">SV</span><strong>Abrindo administração…</strong></div>

  if (!data) {
    return <div className="platform-loading platform-loading--error">
      <ShieldCheck size={34} /><h1>Administração Shopvax</h1><p>{error}</p>
      <form className="platform-claim" onSubmit={claimAdmin}>
        <label><span>Token de ativação inicial</span><input type="password" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} placeholder="SHOPVAX_ADMIN_BOOTSTRAP_TOKEN" minLength={24} /></label>
        <button className="platform-primary" disabled={claiming || claimToken.length < 24}>{claiming ? 'Ativando…' : 'Ativar primeiro administrador'}</button>
      </form>
      <div><button className="platform-secondary" onClick={() => go('/entrar?next=/admin')}>Entrar novamente</button><button className="platform-secondary" onClick={load}>Tentar novamente</button></div>
    </div>
  }

  const sectionTitle: Record<Section, string> = { visao: 'Visão geral', lojas: 'Lojas', contas: 'Contas', planos: 'Planos', admins: 'Administradores', auditoria: 'Auditoria' }

  return <div className="platform-shell">
    <aside className="platform-sidebar">
      <div className="platform-brand"><span className="platform-mark">SV</span><div><strong>Shopvax</strong><small>Administração</small></div></div>
      <nav>
        <NavButton active={section === 'visao'} onClick={() => setSection('visao')} icon={<Activity size={18}/>} label="Visão geral" />
        <NavButton active={section === 'lojas'} onClick={() => setSection('lojas')} icon={<Store size={18}/>} label="Lojas" count={data.stats.stores} />
        <NavButton active={section === 'contas'} onClick={() => setSection('contas')} icon={<Users size={18}/>} label="Contas" count={data.stats.users} />
        <NavButton active={section === 'planos'} onClick={() => setSection('planos')} icon={<CreditCard size={18}/>} label="Planos" count={data.plans.length} />
        <NavButton active={section === 'admins'} onClick={() => setSection('admins')} icon={<ShieldCheck size={18}/>} label="Administradores" count={data.admins.length} />
        <NavButton active={section === 'auditoria'} onClick={() => setSection('auditoria')} icon={<FileClock size={18}/>} label="Auditoria" />
      </nav>
      <div className="platform-sidebar__foot"><div><span>Conectado como</span><strong>{data.user.name}</strong><small>{data.user.email}</small></div><button onClick={logout}><LogOut size={17}/> <span>Sair</span></button></div>
    </aside>

    <main className="platform-main">
      <header className="platform-topbar"><div><span>Shopvax</span><strong>{sectionTitle[section]}</strong></div><a href="/painel">Painel da minha loja <ExternalLink size={14}/></a></header>
      {notice && <div className="platform-toast"><CheckCircle2 size={16}/> {notice}</div>}
      {error && <div className="platform-error">{error}</div>}

      {section === 'visao' && <div className="platform-page">
        <Title kicker="Operação" title="Visão geral" copy="Saúde operacional do Shopvax sem confundir intenção de compra com faturamento confirmado." />
        <section className="platform-metrics">
          <Metric icon={<Store size={18}/>} label="Lojas" value={String(data.stats.stores)} note={`${data.stats.active_stores} ativas`} />
          <Metric icon={<Users size={18}/>} label="Usuários" value={String(data.stats.users)} note="contas cadastradas" />
          <Metric icon={<Package size={18}/>} label="Produtos" value={String(data.stats.products)} note="publicados" />
          <Metric icon={<ReceiptText size={18}/>} label="Pedidos" value={String(data.stats.orders)} note="enviados ao WhatsApp" />
          <Metric icon={<CreditCard size={18}/>} label="Valor dos pedidos" value={money.format(data.stats.order_value)} note="intenção enviada ao WhatsApp" wide />
        </section>
        <section className="platform-grid-2">
          <div className="platform-card"><div className="platform-card__head"><div><span>Lojas recentes</span><h2>Últimas entradas</h2></div><button onClick={() => setSection('lojas')}>Ver todas</button></div><div className="platform-list">{data.stores.slice(0,6).map((store) => <div key={store.id}><span className={`platform-dot ${store.isActive ? 'is-on' : ''}`}/><div><strong>{store.name}</strong><small>{store.ownerName} · {store.ownerEmail}</small></div><b>{store.planCode.toUpperCase()}</b></div>)}</div></div>
          <div className="platform-card"><div className="platform-card__head"><div><span>Usuários recentes</span><h2>Novas contas</h2></div></div><div className="platform-list">{data.latestUsers.slice(0,6).map((user) => <div key={user.id}><div className="platform-avatar">{user.name.slice(0,2).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.storeName || 'Acesso sem loja'} · {user.email}</small></div><b>{date.format(new Date(user.createdAt)).split(' ')[0]}</b></div>)}</div></div>
        </section>
      </div>}

      {section === 'lojas' && <div className="platform-page">
        <Title kicker="Clientes" title="Lojas" copy="Suspenda operações e troque planos sem acessar a conta do cliente." />
        <div className="platform-toolbar"><label><Search size={17}/><input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)} placeholder="Buscar loja, responsável, e-mail ou plano" /></label><span>{filteredStores.length} lojas</span></div>
        <div className="platform-store-list">{filteredStores.map((store) => <article key={store.id}>
          <div className="platform-store-main"><span className={`platform-status ${store.isActive ? 'is-active' : ''}`}>{store.isActive ? 'Ativa' : 'Suspensa'}</span><h2>{store.name}</h2><code>/{store.slug}</code><small>{store.ownerName} · {store.ownerEmail}</small></div>
          <div className="platform-store-stats"><span><b>{store.products}</b> produtos</span><span><b>{store.sellers}</b> vendedoras</span><span><b>{store.orders}</b> pedidos</span><span><b>{money.format(store.orderValue)}</b> pedidos enviados</span></div>
          <div className="platform-store-actions platform-store-actions--stack"><select value={store.planCode} onChange={(e) => void setStorePlan(store, e.target.value)} aria-label={`Plano da ${store.name}`}>{data.plans.filter((plan) => plan.active || plan.code === store.planCode).map((plan) => <option key={plan.id} value={plan.code}>{plan.name}</option>)}</select><div><a href={`/${store.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Abrir</a><button className={store.isActive ? 'is-danger' : 'is-success'} onClick={() => void toggleStore(store)}>{store.isActive ? <><XCircle size={16}/> Suspender</> : <><CheckCircle2 size={16}/> Reativar</>}</button></div></div>
        </article>)}</div>
      </div>}

      {section === 'contas' && <div className="platform-page">
        <Title kicker="Usuários" title="Contas" copy="Busca operacional e exclusão definitiva com reautenticação administrativa." />
        <form className="platform-toolbar" onSubmit={(e) => { e.preventDefault(); void loadAccounts() }}><label><Search size={17}/><input value={accountQuery} onChange={(e) => setAccountQuery(e.target.value)} placeholder="Buscar nome, e-mail ou loja" /></label><button className="platform-secondary" disabled={accountsLoading}>{accountsLoading ? 'Buscando…' : 'Buscar'}</button></form>
        <div className="platform-account-list">{accounts.map((account) => <article key={account.id}><div className="platform-avatar platform-avatar--large">{account.name.slice(0,2).toUpperCase()}</div><div><h2>{account.name}</h2><span>{account.email}</span><small>{account.store ? `${account.store.name} · ${account.store.planCode.toUpperCase()}` : 'Sem loja'}</small></div><div className="platform-account-flags">{account.isAdmin && <b>ADMIN</b>}{account.store && <b>{account.store.isActive ? 'LOJA ATIVA' : 'LOJA SUSPENSA'}</b>}</div><button className="platform-icon-danger" disabled={account.id === data.user.id || account.isAdmin} onClick={() => setDanger({ kind: 'account', id: account.id, name: account.name })} title={account.isAdmin ? 'Remova o acesso administrativo primeiro' : 'Apagar conta'}><Trash2 size={17}/></button></article>)}</div>
      </div>}

      {section === 'planos' && <div className="platform-page">
        <div className="platform-title platform-title--action"><div><span>Comercial</span><h1>Planos</h1><p>Bronze, Prata, Ouro e planos personalizados com limites aplicados no backend.</p></div><button className="platform-primary" onClick={() => setPlanOpen('new')}><CreditCard size={17}/> Novo plano</button></div>
        <div className="platform-plan-grid">{data.plans.map((plan) => <article key={plan.id} className={!plan.active ? 'is-inactive' : ''}><header><div><span>{plan.code}</span><h2>{plan.name}</h2></div><strong>{money.format(plan.monthlyPrice)}<small>/mês</small></strong></header><div className="platform-plan-cycles"><span>Semestral <b>{money.format(semesterPrice(plan))}</b></span><span>Anual <b>{money.format(annualPrice(plan))}</b></span></div><ul><li>{limitLabel(plan.sellerLimit, 'vendedoras')}</li><li>{limitLabel(plan.productLimit, 'produtos')}</li><li>{limitLabel(plan.catalogLimit, 'catálogos')}</li><li>Prioridade de feed: {plan.socialWeight}</li></ul><footer><button className="platform-secondary" onClick={() => setPlanOpen(plan)}><Pencil size={15}/> Editar</button>{!plan.isSystem && <button className="platform-icon-danger" onClick={() => void deletePlan(plan)}><Trash2 size={16}/></button>}</footer></article>)}</div>
      </div>}

      {section === 'admins' && <div className="platform-page">
        <div className="platform-title platform-title--action"><div><span>Acesso</span><h1>Administradores</h1><p>Quem pode gerenciar toda a plataforma.</p></div><button className="platform-primary" onClick={() => setAdminOpen(true)}><UserPlus size={17}/> Adicionar admin</button></div>
        <div className="platform-admin-list">{data.admins.map((admin) => <article key={admin.id}><div className="platform-avatar platform-avatar--large">{admin.name.slice(0,2).toUpperCase()}</div><div><small>ADMINISTRADOR</small><h2>{admin.name}</h2><span>{admin.email}</span></div><div className="platform-admin-origin">{admin.hasStore ? 'Também possui loja' : 'Somente administração'}</div><button disabled={admin.id === data.user.id} onClick={() => setDanger({ kind: 'admin', id: admin.id, name: admin.name })} title={admin.id === data.user.id ? 'Seu próprio acesso não pode ser removido' : 'Remover acesso'}><Trash2 size={17}/></button></article>)}</div>
      </div>}

      {section === 'auditoria' && <div className="platform-page"><Title kicker="Segurança" title="Auditoria" copy="Últimas ações administrativas sensíveis registradas pelo servidor." /><div className="platform-audit-list">{data.audit.map((entry) => <article key={entry.id}><span>{date.format(new Date(entry.createdAt))}</span><strong>{actionLabel(entry.action)}</strong><small>{entry.actorName || 'Sistema'}{entry.actorEmail ? ` · ${entry.actorEmail}` : ''}</small><code>{entry.targetType}{entry.targetId ? ` · ${entry.targetId}` : ''}</code></article>)}</div></div>}
    </main>

    {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} onSaved={async () => { setAdminOpen(false); flash('Administrador adicionado.'); await load() }} />}
    {planOpen && <PlanModal plan={planOpen === 'new' ? null : planOpen} onClose={() => setPlanOpen(null)} onSaved={async () => { setPlanOpen(null); flash('Plano salvo.'); await load() }} />}
    {danger && <DangerModal target={danger} onClose={() => setDanger(null)} onConfirm={executeDanger} />}
  </div>
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return <button className={active ? 'is-active' : ''} onClick={onClick}>{icon}<span>{label}</span>{count != null && <b>{count}</b>}</button>
}
function Title({ kicker, title, copy }: { kicker: string; title: string; copy: string }) { return <div className="platform-title"><span>{kicker}</span><h1>{title}</h1><p>{copy}</p></div> }
function Metric({ icon, label, value, note, wide = false }: { icon: React.ReactNode; label: string; value: string; note: string; wide?: boolean }) { return <div className={wide ? 'is-wide' : ''}><div>{icon}<span>{label}</span></div><strong>{value}</strong><small>{note}</small></div> }

function AdminModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await request('/api/platform/admins', { method: 'POST', body: JSON.stringify(form) }); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível adicionar o administrador.') } finally { setBusy(false) } }
  return <ModalFrame title="Adicionar administrador" kicker="Novo acesso" onClose={onClose}><form onSubmit={submit}><div className="platform-modal__body"><p>Se o e-mail já tiver conta, basta informar o e-mail. Para uma pessoa nova, use uma senha temporária com pelo menos 12 caracteres.</p><label><span>E-mail</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label><label><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label><span>Senha temporária</span><input type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>{error && <p className="platform-form-error">{error}</p>}</div><footer><button type="button" className="platform-secondary" onClick={onClose}>Cancelar</button><button className="platform-primary" disabled={busy}>{busy ? 'Salvando…' : 'Adicionar admin'}</button></footer></form></ModalFrame>
}

function PlanModal({ plan, onClose, onSaved }: { plan: PlatformPlan | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name || '', code: plan?.code || '', monthlyPrice: String(plan?.monthlyPrice ?? ''), semesterDiscount: String(plan?.semesterDiscount ?? 5), annualDiscount: String(plan?.annualDiscount ?? 15),
    sellerLimit: plan?.sellerLimit == null ? '' : String(plan.sellerLimit), productLimit: plan?.productLimit == null ? '' : String(plan.productLimit), catalogLimit: plan?.catalogLimit == null ? '' : String(plan.catalogLimit), socialWeight: String(plan?.socialWeight ?? 1), active: plan?.active ?? true,
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const payload = { ...form, monthlyPrice: Number(form.monthlyPrice), semesterDiscount: Number(form.semesterDiscount), annualDiscount: Number(form.annualDiscount), sellerLimit: form.sellerLimit === '' ? null : Number(form.sellerLimit), productLimit: form.productLimit === '' ? null : Number(form.productLimit), catalogLimit: form.catalogLimit === '' ? null : Number(form.catalogLimit), socialWeight: Number(form.socialWeight) }; await request(plan ? `/api/platform/plans/${plan.id}` : '/api/platform/plans', { method: plan ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o plano.') } finally { setBusy(false) } }
  return <ModalFrame title={plan ? `Editar ${plan.name}` : 'Novo plano'} kicker="Planos" onClose={onClose}><form onSubmit={submit}><div className="platform-modal__body platform-plan-form"><div className="platform-form-grid"><label><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label><span>Código</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(plan)} required /></label></div><div className="platform-form-grid"><label><span>Mensal (R$)</span><input type="number" min="0" step="0.01" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} required /></label><label><span>Semestral desconto %</span><input type="number" min="0" max="95" step="0.01" value={form.semesterDiscount} onChange={(e) => setForm({ ...form, semesterDiscount: e.target.value })} /></label><label><span>Anual desconto %</span><input type="number" min="0" max="95" step="0.01" value={form.annualDiscount} onChange={(e) => setForm({ ...form, annualDiscount: e.target.value })} /></label></div><div className="platform-form-grid"><label><span>Vendedoras</span><input type="number" min="1" value={form.sellerLimit} onChange={(e) => setForm({ ...form, sellerLimit: e.target.value })} placeholder="Ilimitado" /></label><label><span>Produtos</span><input type="number" min="1" value={form.productLimit} onChange={(e) => setForm({ ...form, productLimit: e.target.value })} placeholder="Ilimitado" /></label><label><span>Catálogos</span><input type="number" min="1" value={form.catalogLimit} onChange={(e) => setForm({ ...form, catalogLimit: e.target.value })} placeholder="Ilimitado" /></label></div><label><span>Prioridade no feed (1–3)</span><input type="number" min="1" max="3" value={form.socialWeight} onChange={(e) => setForm({ ...form, socialWeight: e.target.value })} /></label><label className="platform-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/><span>Plano ativo para novas atribuições</span></label>{error && <p className="platform-form-error">{error}</p>}</div><footer><button type="button" className="platform-secondary" onClick={onClose}>Cancelar</button><button className="platform-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar plano'}</button></footer></form></ModalFrame>
}

function DangerModal({ target, onClose, onConfirm }: { target: DangerTarget; onClose: () => void; onConfirm: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (confirm !== 'EXCLUIR') return; setBusy(true); setError(''); try { await onConfirm(password) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível concluir a exclusão.') } finally { setBusy(false) } }
  const title = target.kind === 'account' ? 'Apagar conta definitivamente' : 'Remover administrador'
  return <ModalFrame title={title} kicker="Ação sensível" onClose={onClose}><form onSubmit={submit}><div className="platform-modal__body"><p>Alvo: <strong>{target.name}</strong>. Confirme sua senha administrativa e digite EXCLUIR.</p><label><span>Sua senha</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></label><label><span>Confirmação</span><input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} placeholder="EXCLUIR" required /></label>{error && <p className="platform-form-error">{error}</p>}</div><footer><button type="button" className="platform-secondary" onClick={onClose}>Cancelar</button><button className="platform-danger" disabled={busy || confirm !== 'EXCLUIR' || !password}>{busy ? 'Processando…' : title}</button></footer></form></ModalFrame>
}

function ModalFrame({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="platform-modal-layer"><button className="platform-modal-backdrop" onClick={onClose} aria-label="Fechar"/><div className="platform-modal"><header><div><span>{kicker}</span><h2>{title}</h2></div><button type="button" onClick={onClose}>×</button></header>{children}</div></div>
}
