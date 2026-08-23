import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  LogOut,
  Package,
  ReceiptText,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'

type PlatformStats = {
  users: number
  stores: number
  active_stores: number
  products: number
  orders: number
  order_value: number
}

type PlatformStore = {
  id: string
  slug: string
  name: string
  is_active: boolean
  created_at: string
  owner_name: string
  owner_email: string
  products: number
  sellers: number
  orders: number
  order_value: number
}

type PlatformAdminUser = {
  id: string
  name: string
  email: string
  created_at: string
  has_store: boolean
}

type LatestUser = {
  id: string
  name: string
  email: string
  created_at: string
  store_name?: string | null
  store_slug?: string | null
}

type Bootstrap = {
  user: { id: string; name: string; email: string }
  stats: PlatformStats
  stores: PlatformStore[]
  admins: PlatformAdminUser[]
  latestUsers: LatestUser[]
}

type Section = 'visao' | 'lojas' | 'admins'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function PlatformAdmin() {
  const [section, setSection] = useState<Section>('visao')
  const [data, setData] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setData(await request<Bootstrap>('/api/platform/bootstrap'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o administrativo.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined)
    go('/entrar?next=/admin')
  }

  const toggleStore = async (store: PlatformStore) => {
    try {
      await request(`/api/platform/stores/${store.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !store.is_active }),
      })
      flash(store.is_active ? 'Loja suspensa.' : 'Loja reativada.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar a loja.')
    }
  }

  const removeAdmin = async (admin: PlatformAdminUser) => {
    if (!window.confirm(`Remover o acesso administrativo de ${admin.name}?`)) return
    try {
      await request(`/api/platform/admins/${admin.id}`, { method: 'DELETE' })
      flash('Administrador removido.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover o administrador.')
    }
  }

  const filteredStores = useMemo(() => {
    if (!data) return []
    const term = query.trim().toLowerCase()
    if (!term) return data.stores
    return data.stores.filter((store) =>
      `${store.name} ${store.slug} ${store.owner_name} ${store.owner_email}`.toLowerCase().includes(term),
    )
  }, [data, query])

  if (loading) {
    return (
      <div className="platform-loading">
        <span className="platform-mark">AS</span>
        <strong>Abrindo administração…</strong>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="platform-loading platform-loading--error">
        <ShieldCheck size={34} />
        <h1>Acesso administrativo</h1>
        <p>{error}</p>
        <div>
          <button className="platform-primary" onClick={() => go('/entrar?next=/admin')}>Entrar</button>
          <button className="platform-secondary" onClick={load}>Tentar novamente</button>
        </div>
      </div>
    )
  }

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="platform-brand">
          <span className="platform-mark">AS</span>
          <div><strong>Atacado Shop</strong><small>Administração</small></div>
        </div>

        <nav>
          <button className={section === 'visao' ? 'is-active' : ''} onClick={() => setSection('visao')}>
            <Activity size={18} /><span>Visão geral</span>
          </button>
          <button className={section === 'lojas' ? 'is-active' : ''} onClick={() => setSection('lojas')}>
            <Store size={18} /><span>Lojas</span><b>{data.stats.stores}</b>
          </button>
          <button className={section === 'admins' ? 'is-active' : ''} onClick={() => setSection('admins')}>
            <ShieldCheck size={18} /><span>Administradores</span><b>{data.admins.length}</b>
          </button>
        </nav>

        <div className="platform-sidebar__foot">
          <div><span>Conectado como</span><strong>{data.user.name}</strong><small>{data.user.email}</small></div>
          <button onClick={logout}><LogOut size={17} /> Sair</button>
        </div>
      </aside>

      <main className="platform-main">
        <header className="platform-topbar">
          <div><span>Atacado Shop</span><strong>{section === 'visao' ? 'Visão geral' : section === 'lojas' ? 'Lojas' : 'Administradores'}</strong></div>
          <a href="/painel">Painel da minha loja <ExternalLink size={14} /></a>
        </header>

        {notice && <div className="platform-toast"><CheckCircle2 size={16} /> {notice}</div>}
        {error && <div className="platform-error">{error}</div>}

        {section === 'visao' && (
          <div className="platform-page">
            <div className="platform-title"><span>Operação</span><h1>Visão geral</h1><p>O essencial da plataforma em uma tela.</p></div>
            <section className="platform-metrics">
              <Metric icon={<Store size={18} />} label="Lojas" value={String(data.stats.stores)} note={`${data.stats.active_stores} ativas`} />
              <Metric icon={<Users size={18} />} label="Usuários" value={String(data.stats.users)} note="contas cadastradas" />
              <Metric icon={<Package size={18} />} label="Produtos" value={String(data.stats.products)} note="no catálogo" />
              <Metric icon={<ReceiptText size={18} />} label="Pedidos" value={String(data.stats.orders)} note="enviados ao WhatsApp" />
              <Metric icon={<DollarSign size={18} />} label="Valor gerado" value={money.format(data.stats.order_value)} note="em pedidos" wide />
            </section>

            <section className="platform-grid-2">
              <div className="platform-card">
                <div className="platform-card__head"><div><span>Lojas recentes</span><h2>Últimas entradas</h2></div><button onClick={() => setSection('lojas')}>Ver todas</button></div>
                <div className="platform-list">
                  {data.stores.slice(0, 6).map((store) => (
                    <div key={store.id}>
                      <span className={`platform-dot ${store.is_active ? 'is-on' : ''}`} />
                      <div><strong>{store.name}</strong><small>{store.owner_name} · {store.owner_email}</small></div>
                      <b>{store.products} prod.</b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="platform-card">
                <div className="platform-card__head"><div><span>Usuários recentes</span><h2>Novas contas</h2></div></div>
                <div className="platform-list">
                  {data.latestUsers.slice(0, 6).map((user) => (
                    <div key={user.id}>
                      <div className="platform-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                      <div><strong>{user.name}</strong><small>{user.store_name || 'Acesso administrativo'} · {user.email}</small></div>
                      <b>{date.format(new Date(user.created_at)).split(' ')[0]}</b>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {section === 'lojas' && (
          <div className="platform-page">
            <div className="platform-title"><span>Clientes</span><h1>Lojas</h1><p>Acompanhe e controle as lojas cadastradas.</p></div>
            <div className="platform-toolbar">
              <label><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar loja, responsável ou e-mail" /></label>
              <span>{filteredStores.length} lojas</span>
            </div>
            <div className="platform-store-list">
              {filteredStores.map((store) => (
                <article key={store.id}>
                  <div className="platform-store-main">
                    <span className={`platform-status ${store.is_active ? 'is-active' : ''}`}>{store.is_active ? 'Ativa' : 'Suspensa'}</span>
                    <h2>{store.name}</h2>
                    <code>/{store.slug}</code>
                    <small>{store.owner_name} · {store.owner_email}</small>
                  </div>
                  <div className="platform-store-stats">
                    <span><b>{store.products}</b> produtos</span>
                    <span><b>{store.sellers}</b> vendedoras</span>
                    <span><b>{store.orders}</b> pedidos</span>
                    <span><b>{money.format(store.order_value)}</b> gerados</span>
                  </div>
                  <div className="platform-store-actions">
                    <a href={`/${store.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir</a>
                    <button className={store.is_active ? 'is-danger' : 'is-success'} onClick={() => toggleStore(store)}>
                      {store.is_active ? <><XCircle size={16} /> Suspender</> : <><CheckCircle2 size={16} /> Reativar</>}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {section === 'admins' && (
          <div className="platform-page">
            <div className="platform-title platform-title--action">
              <div><span>Acesso</span><h1>Administradores</h1><p>Quem pode gerenciar toda a plataforma.</p></div>
              <button className="platform-primary" onClick={() => setAdminOpen(true)}><UserPlus size={17} /> Adicionar admin</button>
            </div>
            <div className="platform-admin-list">
              {data.admins.map((admin) => (
                <article key={admin.id}>
                  <div className="platform-avatar platform-avatar--large">{admin.name.slice(0, 2).toUpperCase()}</div>
                  <div><small>ADMINISTRADOR</small><h2>{admin.name}</h2><span>{admin.email}</span></div>
                  <div className="platform-admin-origin">{admin.has_store ? 'Também possui loja' : 'Somente administração'}</div>
                  <button disabled={admin.id === data.user.id} onClick={() => removeAdmin(admin)} title={admin.id === data.user.id ? 'Seu próprio acesso não pode ser removido' : 'Remover acesso'}><Trash2 size={17} /></button>
                </article>
              ))}
            </div>
          </div>
        )}
      </main>

      {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} onSaved={async () => { setAdminOpen(false); flash('Administrador adicionado.'); await load() }} />}
    </div>
  )
}

function Metric({ icon, label, value, note, wide = false }: { icon: React.ReactNode; label: string; value: string; note: string; wide?: boolean }) {
  return <div className={wide ? 'is-wide' : ''}><div>{icon}<span>{label}</span></div><strong>{value}</strong><small>{note}</small></div>
}

function AdminModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request('/api/platform/admins', { method: 'POST', body: JSON.stringify(form) })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível adicionar o administrador.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="platform-modal-layer">
      <button className="platform-modal-backdrop" onClick={onClose} aria-label="Fechar" />
      <form className="platform-modal" onSubmit={submit}>
        <header><div><span>Novo acesso</span><h2>Adicionar administrador</h2></div><button type="button" onClick={onClose}>×</button></header>
        <div className="platform-modal__body">
          <p>Se o e-mail já tiver conta, basta informar o e-mail. Para uma pessoa nova, preencha também nome e senha temporária.</p>
          <label><span>E-mail</span><input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required placeholder="admin@empresa.com" /></label>
          <label><span>Nome</span><input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Opcional se já tiver conta" /></label>
          <label><span>Senha temporária</span><input type="password" minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Mínimo 8 caracteres para novo usuário" /></label>
          {error && <p className="platform-form-error">{error}</p>}
        </div>
        <footer><button type="button" className="platform-secondary" onClick={onClose}>Cancelar</button><button className="platform-primary" disabled={busy}>{busy ? 'Salvando…' : 'Adicionar admin'}</button></footer>
      </form>
    </div>
  )
}
