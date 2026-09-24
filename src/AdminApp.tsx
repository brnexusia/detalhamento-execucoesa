import { useEffect, useState } from 'react'
import { ArrowRight, Boxes, Check, ChevronLeft, ChevronRight, Clipboard, CreditCard, Eye, EyeOff, ExternalLink, ImagePlus, Link2, LogOut, Menu, Package, Pencil, Plus, ReceiptText, Search, Settings, Store as StoreIcon, Trash2, TrendingUp, Upload, Users, X } from 'lucide-react'
import { api } from './api'
import AdminNavigation from './AdminNavigation'
import CommercialSettingsPanel from './CommercialSettingsPanel'
import { confirmAction } from './ui-dialogs'
import { confirmNavigationIfDirty } from './unsaved-changes'
import type { AdminBootstrap, AdminProduct, AdminSeller, VariationGroup } from './types'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type Section = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'loja'
type ProductDraft = { id?: string; name: string; sku: string; description: string; price: string; category: string; pack: string; mediaUrl: string; mediaType: 'image' | 'video'; images: string[]; variationsText: string; featured: boolean; active: boolean; stockEnabled: boolean; stockQuantity: number; variantStock: Record<string, number> }
const blankProduct: ProductDraft = { name: '', sku: '', description: '', price: '', category: '', pack: '', mediaUrl: '', mediaType: 'image', images: [], variationsText: '', featured: false, active: true, stockEnabled: false, stockQuantity: 0, variantStock: {} }

function go(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
function currentSection(): Section { const segment = window.location.pathname.split('/').filter(Boolean)[1]; return ['produtos', 'pedidos', 'vendedoras', 'loja'].includes(segment) ? segment as Section : 'inicio' }
function variationText(groups: VariationGroup[]) { return (groups || []).map((group) => `${group.name}: ${group.options.join(', ')}`).join('\n') }
function parseVariations(text: string): VariationGroup[] {
  return text.split('\n').map((line) => { const [name, ...rest] = line.split(':'); return { name: name?.trim() || '', options: rest.join(':').split(',').map((option) => option.trim()).filter(Boolean) } }).filter((group) => group.name && group.options.length)
}
function productDraft(product: AdminProduct): ProductDraft { return { id: product.id, name: product.name, sku: product.sku, description: product.description, price: String(product.price), category: product.category, pack: product.pack, mediaUrl: product.media_url, mediaType: product.media_type, images: Array.isArray(product.images) ? product.images : [], variationsText: variationText(product.variations), featured: product.featured, active: product.active, stockEnabled: Boolean(product.stock_enabled), stockQuantity: Number(product.stock_quantity || 0), variantStock: product.variant_stock || {} } }

function AdminProductMedia({ product }: { product: AdminProduct }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [product.media_url])
  if (!product.media_url || failed) return <div className="media-fallback"><ImagePlus size={28}/><span>Imagem indisponível</span></div>
  if (product.media_type === 'video') return <video src={product.media_url} muted onError={() => setFailed(true)} />
  return <img src={product.media_url} alt={product.name} onError={() => setFailed(true)} />
}
function phoneDigits(value: string) { return value.replace(/\D/g, '') }
function countLabel(value: number, singular: string, plural = `${singular}s`) { return `${value} ${value === 1 ? singular : plural}` }
function formatWhatsapp(value: string) {
  let raw = phoneDigits(value)
  if (!raw) return ''
  if (raw.startsWith('55')) raw = raw.slice(2)
  raw = raw.slice(0, 11)
  const ddd = raw.slice(0, 2)
  const number = raw.slice(2)
  let formatted = '+55'
  if (ddd) formatted += ` (${ddd}${ddd.length === 2 ? ')' : ''}`
  if (number) {
    const firstBlock = number.length > 8 ? 5 : 4
    formatted += ` ${number.slice(0, firstBlock)}`
    if (number.length > firstBlock) formatted += `-${number.slice(firstBlock)}`
  }
  return formatted
}

export default function AdminApp() {
  const [section, setSection] = useState<Section>(currentSection)
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [productModal, setProductModal] = useState<ProductDraft | null>(null)
  const [sellerModal, setSellerModal] = useState<Partial<AdminSeller> | null>(null)
  const [query, setQuery] = useState('')
  const [storeDirty, setStoreDirty] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await api.bootstrap()) }
    catch (err) { const message = err instanceof Error ? err.message : 'Não foi possível carregar o painel.'; if (/sessão/i.test(message)) go('/entrar'); else setError(message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { const onPop = () => setSection(currentSection()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop) }, [])

  const canLeaveStore = async () => section !== 'loja' || !storeDirty || await confirmAction('Você tem alterações não salvas. Deseja sair sem salvar?', 'Descartar alterações', 'Sair sem salvar')
  const changeSection = async (next: Section) => { if (next !== section && !(await canLeaveStore())) return; setStoreDirty(false); setSection(next); setMenuOpen(false); window.history.pushState({}, '', next === 'inicio' ? '/painel' : `/painel/${next}`) }
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('Link copiado.') }
  const logout = async () => { if (!(await canLeaveStore())) return; await api.logout().catch(() => undefined); go('/entrar') }

  if (loading) return <div className="panel-loading"><span className="brand__mark">SV</span><strong>Abrindo seu painel…</strong></div>
  if (!data) return <div className="panel-loading panel-loading--error"><span className="brand__mark">SV</span><strong>O painel não conseguiu iniciar.</strong><p>{error}</p><button className="primary-action" onClick={load}>Tentar novamente</button></div>

  const baseUrl = window.location.origin
  const storeUrl = `${baseUrl}/${data.store.slug}`
  const incomplete = data.products.length === 0 || data.sellers.length === 0 || !data.store.whatsapp

  return (
    <div className="panel-shell">
      <aside className={`panel-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="panel-brand"><span className="brand__mark">SV</span><div><strong>Shopvax</strong><small>{data.store.name}</small></div><button className="panel-close-menu" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        <AdminNavigation
          active={section}
          counts={{ products: data.products.length, orders: data.orders.length, sellers: data.sellers.length }}
          planCode={data.store.plan_tier}
          onNavigate={() => setMenuOpen(false)}
          beforeNavigate={async () => (await canLeaveStore()) && (await confirmNavigationIfDirty())}
        />
        <div className="panel-sidebar__foot"><a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Ver loja</a><button onClick={logout}><LogOut size={17} /> Sair</button></div>
      </aside>
      <main className="panel-main">
        <header className="panel-topbar"><button className="panel-menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><div><span>{section === 'inicio' ? 'Operação' : section}</span><strong>{section === 'inicio' ? `Olá, ${data.user.name.split(' ')[0]}.` : section[0].toUpperCase() + section.slice(1)}</strong></div><a className="panel-store-link" href={storeUrl} target="_blank" rel="noreferrer"><StoreIcon size={17} /> Abrir loja <ExternalLink size={14} /></a></header>
        {notice && <div className="toast"><Check size={16} /> {notice}</div>}
        {error && <div className="panel-error">{error}</div>}
        {section === 'inicio' && <Dashboard data={data} incomplete={incomplete} storeUrl={storeUrl} onSection={changeSection} onCopy={() => copy(storeUrl)} />}
        {section === 'produtos' && <Products data={data} query={query} setQuery={setQuery} onCreate={() => setProductModal({ ...blankProduct })} onEdit={(product) => setProductModal(productDraft(product))} onVisibility={async (product) => { await api.setProductVisibility(product.id, !product.active); flash(product.active ? 'Produto escondido da loja e do feed.' : 'Produto publicado novamente.'); await load() }} onDelete={async (product) => { if (!(await confirmAction(`Excluir ${product.name}? Esta ação não pode ser desfeita.`, 'Excluir produto', 'Excluir'))) return; await api.deleteProduct(product.id); flash('Produto excluído.'); load() }} />}
        {section === 'pedidos' && <Orders data={data} />}
        {section === 'vendedoras' && <Sellers data={data} baseUrl={baseUrl} onCopy={copy} onCreate={() => setSellerModal({ name: '', phone: '', slug: '', is_active: true })} onEdit={(seller) => setSellerModal({ ...seller })} onDelete={async (seller) => { if (!(await confirmAction(`Excluir ${seller.name}? O link individual deixará de funcionar.`, 'Excluir vendedora', 'Excluir'))) return; await api.deleteSeller(seller.id); flash('Vendedora excluída.'); load() }} />}
        {section === 'loja' && <><StoreSettings data={data} onSaved={() => { flash('Loja atualizada.'); load() }} onCopy={copy} onDirtyChange={setStoreDirty} /><CommercialSettingsPanel embedded/><StoreTools data={data}/></>}
      </main>
      {productModal && <ProductEditor draft={productModal} setDraft={setProductModal} onClose={() => setProductModal(null)} onSaved={() => { setProductModal(null); flash(productModal.id ? 'Produto atualizado.' : 'Produto cadastrado.'); load() }} />}
      {sellerModal && <SellerEditor draft={sellerModal} setDraft={setSellerModal} storeSlug={data.store.slug} onClose={() => setSellerModal(null)} onSaved={() => { setSellerModal(null); flash(sellerModal.id ? 'Vendedora atualizada.' : 'Vendedora cadastrada.'); load() }} />}
    </div>
  )
}

function Dashboard({ data, incomplete, storeUrl, onSection, onCopy }: { data: AdminBootstrap; incomplete: boolean; storeUrl: string; onSection: (section: Section) => void; onCopy: () => void }) {
  const storeActive = data.store.is_active
  const hasProducts = data.products.length > 0
  return <div className="panel-page">
    {incomplete && <section className="setup-card"><div><span>Primeiros passos</span><h2>Deixe a loja pronta para receber pedidos.</h2></div><div className="setup-list"><button className={data.store.whatsapp ? 'is-done' : ''} onClick={() => onSection('loja')}><span>{data.store.whatsapp ? <Check size={16} /> : '1'}</span><div><strong>Configure a loja</strong><small>WhatsApp, pedido mínimo e link da loja.</small></div><ChevronRight size={18} /></button><button className={data.products.length ? 'is-done' : ''} onClick={() => onSection('produtos')}><span>{data.products.length ? <Check size={16} /> : '2'}</span><div><strong>Cadastre produtos</strong><small>Foto ou vídeo, preço e variações.</small></div><ChevronRight size={18} /></button><button className={data.sellers.length ? 'is-done' : ''} onClick={() => onSection('vendedoras')}><span>{data.sellers.length ? <Check size={16} /> : '3'}</span><div><strong>Adicione vendedoras</strong><small>Cada uma recebe seu próprio link.</small></div><ChevronRight size={18} /></button></div></section>}
    <section className="metric-row metric-row--three"><div><span>Acessos</span><strong>{data.stats.views}</strong><small>na loja</small></div><div><span>Carrinhos</span><strong>{data.stats.carts}</strong><small>iniciados</small></div><div><span>Pedidos</span><strong>{data.stats.orders}</strong><small>enviados ao WhatsApp</small></div></section>
    <section className="panel-split"><div className="plain-card"><div className="section-head"><div><span>Seu link</span><h2 className="store-published-title">Loja <span className={`published-badge ${storeActive ? '' : 'is-paused'}`}>{storeActive ? 'Publicada' : 'Pausada'}</span></h2></div><a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /></a></div><div className="copy-line"><code>{storeUrl.replace(/^https?:\/\//, '')}</code><button onClick={onCopy}><Clipboard size={16} /> Copiar</button></div><p>{storeActive ? 'Use o link geral ou compartilhe o link individual de cada vendedora.' : 'A loja está pausada. O link continua aqui para quando ela for reativada.'}</p></div><div className="plain-card"><div className="section-head"><div><span>Últimos pedidos</span><h2>{data.orders.length ? countLabel(data.orders.length, 'pedido registrado', 'pedidos registrados') : 'Ainda vazio'}</h2></div><button onClick={() => onSection('pedidos')}>Ver todos</button></div><div className="mini-orders">{data.orders.slice(0, 4).map((order) => <div key={order.id}><strong>{order.code}</strong><span>{order.items.length} linhas</span><b>{money.format(order.total)}</b></div>)}{!data.orders.length && <div className="empty-orders-action"><p>{hasProducts ? 'Seus produtos já estão prontos. Compartilhe a loja para começar a receber pedidos.' : 'Cadastre seus primeiros produtos para preparar a loja para vendas.'}</p><button onClick={hasProducts ? onCopy : () => onSection('produtos')}>{hasProducts ? 'Copiar link da loja' : 'Adicionar produtos'}</button></div>}</div></div></section>
  </div>
}

function Products({ data, query, setQuery, onCreate, onEdit, onVisibility, onDelete }: { data: AdminBootstrap; query: string; setQuery: (value: string) => void; onCreate: () => void; onEdit: (p: AdminProduct) => void; onVisibility: (p: AdminProduct) => void | Promise<void>; onDelete: (p: AdminProduct) => void }) {
  const [page, setPage] = useState(1)
  const pageSize = 18
  const products = data.products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  const pages = Math.max(1, Math.ceil(products.length / pageSize))
  const visible = products.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1) }, [query, data.products.length])
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])

  return <div className="panel-page"><div className="page-title"><div><span>Catálogo</span><h1>Produtos</h1><p>Cadastro, fotos, variações e estoque ficam juntos para evitar caminhos duplicados.</p></div><button className="primary-action" onClick={onCreate}><Plus size={18} /> Novo produto</button></div>
    <div className="table-toolbar"><label><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome, SKU ou categoria" /></label><span>{products.length === data.products.length ? countLabel(products.length, 'produto') : `${products.length} de ${data.products.length} produtos`}</span></div>
    <div className="product-admin-grid">{visible.map((product) => <article className="product-admin-card" key={product.id}><div className="product-admin-card__media"><AdminProductMedia product={product}/>{!product.active && <span>oculto</span>}</div><div className="product-admin-card__body"><small>{product.sku || 'SEM SKU'} · {product.category}</small><h3>{product.name}</h3><strong>{money.format(product.price)}</strong>{product.variations?.length > 0 && <p>{product.variations.map((group) => `${group.name}: ${group.options.join('/')}`).join(' · ')}</p>}<p>{countLabel(Array.isArray(product.images) ? product.images.length : 0, 'foto')} · {product.stock_enabled ? `${product.stock_quantity || 0} em estoque` : 'estoque livre'}</p></div><div className="product-admin-card__actions"><button onClick={() => onEdit(product)}><Pencil size={16} /> Editar</button><button onClick={() => void onVisibility(product)} aria-label={product.active ? `Esconder ${product.name}` : `Mostrar ${product.name}`}>{product.active ? <EyeOff size={16}/> : <Eye size={16}/>} {product.active ? 'Esconder' : 'Mostrar'}</button><button className="danger" aria-label={`Excluir ${product.name}`} onClick={() => onDelete(product)}><Trash2 size={16} /></button></div></article>)}</div>
    {!products.length && <div className="admin-empty"><Package size={30} /><h2>{data.products.length ? 'Nenhum produto encontrado.' : 'Cadastre seu primeiro produto.'}</h2><p>Você pode usar fotos ou vídeo, criar variações e controlar estoque na mesma edição.</p><button className="primary-action" onClick={onCreate}><Plus size={18} /> Cadastrar produto</button></div>}
    {products.length > pageSize && <div className="panel-pagination"><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span>Página {page} de {pages}</span><button disabled={page === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Próxima</button></div>}
  </div>
}

function Orders({ data }: { data: AdminBootstrap }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [period, setPeriod] = useState('30')
  const sellerName = (id?: string | null) => data.sellers.find((seller) => seller.id === id)?.name || 'Loja'
  const statusLabel = (value: string) => ({ whatsapp: 'Enviado ao WhatsApp', em_atendimento: 'Em atendimento', confirmado: 'Venda confirmada', cancelled: 'Cancelado', arquivado: 'Arquivado' } as Record<string, string>)[value] || value
  const statuses = Array.from(new Set(data.orders.map((order) => order.status))).filter(Boolean)
  const since = period === 'all' ? 0 : Date.now() - Number(period) * 86400000
  const filtered = data.orders.filter((order) => {
    const text = `${order.code} ${sellerName(order.seller_id)}`.toLowerCase()
    return (!query.trim() || text.includes(query.trim().toLowerCase()))
      && (status === 'all' || order.status === status)
      && (!since || new Date(order.created_at).getTime() >= since)
  })
  return <div className="panel-page"><div className="page-title"><div><span>WhatsApp</span><h1>Pedidos</h1><p>Pedidos registrados quando o cliente envia o carrinho para atendimento.</p></div></div>
    <div className="orders-filters"><label><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pedido ou vendedora"/></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos os status</option>{statuses.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="all">Todo o período</option></select><span>{countLabel(filtered.length, 'pedido')}</span></div>
    <div className="orders-table"><div className="orders-table__head"><span>Pedido</span><span>Vendedora</span><span>Itens</span><span>Quando</span><span>Status</span><span>Total</span></div>{filtered.map((order) => <div className="orders-table__row" key={order.id}><strong>{order.code}</strong><span>{sellerName(order.seller_id)}</span><span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} un.</span><span>{date.format(new Date(order.created_at))}</span><span>{statusLabel(order.status)}</span><b>{money.format(order.total)}</b></div>)}</div>
    {!filtered.length && <div className="admin-empty"><ReceiptText size={30} /><h2>{data.orders.length ? 'Nenhum pedido neste filtro.' : 'Nenhum pedido ainda.'}</h2><p>{data.orders.length ? 'Ajuste a busca, o status ou o período.' : 'Quando o cliente enviar o carrinho para o WhatsApp, ele fica registrado aqui.'}</p></div>}
  </div>
}

function Sellers({ data, baseUrl, onCopy, onCreate, onEdit, onDelete }: { data: AdminBootstrap; baseUrl: string; onCopy: (value: string) => void; onCreate: () => void; onEdit: (seller: AdminSeller) => void; onDelete: (seller: AdminSeller) => void }) {
  return <div className="panel-page"><div className="page-title"><div><span>Equipe</span><h1>Vendedoras</h1><p>Cada pessoa ganha um endereço próprio da mesma loja.</p></div><button className="primary-action" onClick={onCreate}><Plus size={18} /> Nova vendedora</button></div><div className="seller-list">{data.sellers.map((seller) => { const orders = data.orders.filter((order) => order.seller_id === seller.id); const value = orders.reduce((sum, order) => sum + order.total, 0); const link = `${baseUrl}/${data.store.slug}/${seller.slug}`; return <article key={seller.id}><div className="seller-avatar">{seller.name.slice(0, 2).toUpperCase()}</div><div className="seller-main"><small>{seller.is_active ? 'ATIVA' : 'PAUSADA'}</small><h3>{seller.name}</h3><span>{seller.phone}</span></div><div className="seller-stats"><span><b>{orders.length}</b> {orders.length === 1 ? 'pedido' : 'pedidos'}</span><span><b>{money.format(value)}</b> em pedidos enviados</span></div><div className="seller-link"><code>/{data.store.slug}/{seller.slug}</code><button onClick={() => onCopy(link)}><Clipboard size={15} /> Copiar link</button></div><div className="seller-actions"><button onClick={() => onEdit(seller)}><Pencil size={16} /></button><button className="danger" onClick={() => onDelete(seller)}><Trash2 size={16} /></button></div></article> })}</div>{!data.sellers.length && <div className="admin-empty"><Users size={30} /><h2>Cadastre quem vende.</h2><p>O link individual garante que o carrinho volte para a vendedora certa.</p><button className="primary-action" onClick={onCreate}><Plus size={18} /> Cadastrar vendedora</button></div>}</div>
}

function StoreSettings({ data, onSaved, onCopy, onDirtyChange }: { data: AdminBootstrap; onSaved: () => void; onCopy: (value: string) => void; onDirtyChange: (dirty: boolean) => void }) {
  const initialForm = { name: data.store.name, slug: data.store.slug, eyebrow: data.store.eyebrow, tagline: data.store.tagline, minimumOrder: String(data.store.minimum_order), whatsapp: formatWhatsapp(data.store.whatsapp), logoUrl: data.store.logo_url, accent: data.store.accent }
  const [form, setForm] = useState(initialForm)
  const [savedForm, setSavedForm] = useState(initialForm)
  const [busy, setBusy] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm)
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const url = `${window.location.origin}/${form.slug}`

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const uploadLogo = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('A logo precisa ser uma imagem.'); return }
    setUploadingLogo(true); setError('')
    try { const result = await api.upload(file); update('logoUrl', result.url) }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar a logo.') }
    finally { setUploadingLogo(false) }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const whatsapp = phoneDigits(form.whatsapp)
    if (whatsapp && !/^55\d{10,11}$/.test(whatsapp)) { setError('Confira o WhatsApp. Use DDD + número completo.'); return }
    setBusy(true); setError('')
    try {
      await api.updateStore({ ...form, whatsapp })
      setSavedForm(form)
      onDirtyChange(false)
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setBusy(false) }
  }

  return <div className="panel-page"><div className="page-title"><div><span>Publicação</span><h1>Minha loja</h1><p>Só o necessário para sua vitrine ficar com a sua cara.</p></div></div><form className="settings-layout settings-layout--ux" onSubmit={save}><section className="settings-card"><h2>Identidade</h2><label><span>Nome da loja</span><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></label><label><span>Frase pequena</span><input value={form.eyebrow} onChange={(e) => update('eyebrow', e.target.value)} placeholder="Atacado de moda feminina" /></label><label><span>Chamada da capa</span><textarea value={form.tagline} onChange={(e) => update('tagline', e.target.value)} rows={3} /></label><label><span>Logo</span><div className="logo-upload-control"><div className="logo-upload-preview">{form.logoUrl ? <img src={form.logoUrl} alt="Prévia da logo" /> : <span>LOGO</span>}</div><div><label className="logo-upload-button"><Upload size={16} /> {uploadingLogo ? 'Enviando…' : form.logoUrl ? 'Trocar logo' : 'Enviar logo'}<input type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files?.[0])} disabled={uploadingLogo} /></label><p className="logo-upload-help">Escolha a imagem direto do celular ou computador.</p></div></div></label><label className="color-field"><span>Cor principal</span><div><input type="color" value={form.accent} onChange={(e) => update('accent', e.target.value)} /><code>{form.accent}</code></div></label></section><section className="settings-card"><h2>Venda</h2><label><span>Pedido mínimo</span><div className="money-input"><span>R$</span><input type="number" step="0.01" min="0" value={form.minimumOrder} onChange={(e) => update('minimumOrder', e.target.value)} /></div></label><label><span>WhatsApp padrão</span><div className="whatsapp-input"><input value={form.whatsapp} inputMode="tel" onChange={(e) => update('whatsapp', formatWhatsapp(e.target.value))} placeholder="+55 (11) 99197-2120" /></div><small className="field-help">DDD e número completo. O sistema valida antes de salvar.</small></label><h2 className="settings-subtitle">Link da loja</h2><label><span>URL da loja</span><div className="url-input"><em>{window.location.host}/</em><input value={form.slug} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div></label><div className="copy-line"><code>{url.replace(/^https?:\/\//, '')}</code><button type="button" onClick={() => onCopy(url)}><Clipboard size={16} /> Copiar</button></div><div className="checkout-visibility-note"><strong>Frete e forma de pagamento</strong><p>Continuam sendo combinados com o cliente no WhatsApp depois que o carrinho é enviado para a vendedora.</p></div></section><section className="settings-card store-preview-card" style={{ '--preview-accent': form.accent } as React.CSSProperties}><h2>Prévia da loja</h2><div className="store-preview-head"><div className="store-preview-logo">{form.logoUrl ? <img src={form.logoUrl} alt="" /> : <span>SV</span>}</div><strong>{form.name || 'Sua loja'}</strong></div><div className="store-preview-body"><span>{form.eyebrow || 'Atacado'}</span><p>{form.tagline || 'Sua chamada principal aparece aqui.'}</p></div></section><div className="settings-save settings-save--sticky">{dirty && <span className="unsaved-indicator">Alterações não salvas</span>}{error && <p className="form-error">{error}</p>}<button className={`primary-action ${dirty ? 'has-changes' : ''}`} disabled={busy || uploadingLogo || !dirty}>{busy ? 'Salvando…' : 'Salvar alterações'}<ArrowRight size={18} /></button></div></form></div>
}


function StoreTools({ data }: { data: AdminBootstrap }) {
  const plan = String(data.store.plan_tier || 'bronze').toLowerCase()
  const prataPlus = plan === 'prata' || plan === 'ouro'
  const ouro = plan === 'ouro'
  const open = (path: string) => go(path)
  return <div className="panel-page panel-page--tools"><div className="page-title page-title--compact"><div><span>Configurações</span><h1>Recursos da loja</h1><p>Ferramentas menos frequentes ficam aqui, sem ocupar a navegação principal.</p></div></div><div className="store-tools-grid">
    <button onClick={() => open('/painel/operacao')}><Settings size={20}/><div><strong>Clientes e domínio</strong><span>Clientes, domínio e personalização da loja.</span></div><ChevronRight size={18}/></button>
    <button onClick={() => open('/painel/crescimento')}><TrendingUp size={20}/><div><strong>Crescimento</strong><span>Cupons, avaliações, indicação e recuperação.</span></div><ChevronRight size={18}/></button>
    {prataPlus && <button onClick={() => open('/painel/recursos')}><Boxes size={20}/><div><strong>Estoque avançado e catálogos</strong><span>Controle por grade e catálogos específicos.</span></div><ChevronRight size={18}/></button>}
    {ouro && <button onClick={() => open('/painel/integracoes')}><Link2 size={20}/><div><strong>Integrações</strong><span>Pagamento, frete, Meta Shopping e API/ERP.</span></div><ChevronRight size={18}/></button>}
    <button onClick={() => open('/painel/assinatura')}><CreditCard size={20}/><div><strong>Plano e uso</strong><span>Plano atual, limites, créditos e segurança da conta.</span></div><ChevronRight size={18}/></button>
  </div>{!prataPlus && <div className="plan-context-note"><strong>Plano Bronze</strong><span>Recursos do Prata e Ouro aparecem aqui quando o plano da loja for alterado.</span></div>}</div>
}

function ProductEditor({ draft, setDraft, onClose, onSaved }: { draft: ProductDraft; setDraft: (draft: ProductDraft | null) => void; onClose: () => void; onSaved: () => void }) {
  const initialSnapshot = useState(() => JSON.stringify(draft))[0]
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [gallery, setGallery] = useState<string[]>(() => {
    const values = [...(draft.images || [])]
    if (draft.mediaType === 'image' && draft.mediaUrl && !values.includes(draft.mediaUrl)) values.unshift(draft.mediaUrl)
    return Array.from(new Set(values.filter(Boolean)))
  })
  const [galleryInitial] = useState(() => JSON.stringify(gallery))
  const [photoLimit, setPhotoLimit] = useState<number | null>(null)
  const [stockAllowed, setStockAllowed] = useState(false)
  const [error, setError] = useState('')
  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft({ ...draft, [key]: value })

  useEffect(() => {
    api.planContext().then((context) => {
      setPhotoLimit(context.plan.limits.photosPerProduct)
      setStockAllowed(Boolean(context.plan.features?.stock))
    }).catch(() => undefined)
  }, [])

  const dirty = JSON.stringify(draft) !== initialSnapshot || JSON.stringify(gallery) !== galleryInitial
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const requestClose = async () => {
    if (dirty && !(await confirmAction('Há alterações ainda não salvas neste produto.', 'Descartar alterações', 'Descartar'))) return
    onClose()
  }
  const upload = async (file?: File) => { if (!file) return; setUploading(true); setError(''); try { const result = await api.upload(file); const previousMain = draft.mediaType === 'image' ? draft.mediaUrl : ''; setDraft({ ...draft, mediaUrl: result.url, mediaType: result.type }); if (result.type === 'image') setGallery((current) => Array.from(new Set([result.url, ...current.filter((url) => url !== previousMain && url !== result.url)]))) } catch (err) { setError(err instanceof Error ? err.message : 'Falha no upload.') } finally { setUploading(false) } }
  const uploadGallery = async (files: FileList | null) => {
    if (!files?.length) return
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    const available = photoLimit == null ? images.length : Math.max(0, photoLimit - gallery.length)
    if (available <= 0) { setError(`Limite de ${photoLimit} fotos atingido neste produto.`); return }
    setUploading(true); setError('')
    try {
      const urls: string[] = []
      for (const file of images.slice(0, available)) {
        const result = await api.upload(file)
        if (result.type === 'image') urls.push(result.url)
      }
      setGallery((current) => Array.from(new Set([...current, ...urls])))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar as fotos.') }
    finally { setUploading(false) }
  }
  const moveGallery = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= gallery.length) return
    const next = [...gallery]
    ;[next[index], next[target]] = [next[target], next[index]]
    setGallery(next)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const galleryToSave = draft.mediaType === 'image' && draft.mediaUrl
      ? Array.from(new Set([draft.mediaUrl, ...gallery.filter((url) => url !== draft.mediaUrl)]))
      : gallery
    const cover = draft.mediaType === 'video' ? draft.mediaUrl : galleryToSave[0] || draft.mediaUrl
    const body = { name: draft.name, sku: draft.sku, description: draft.description, price: Number(draft.price), category: draft.category, pack: draft.pack, mediaUrl: cover, mediaType: draft.mediaType, variations: parseVariations(draft.variationsText), featured: draft.featured, active: draft.active }
    try {
      let productId = draft.id
      if (productId) await api.updateProduct(productId, body)
      else {
        const created = await api.createProduct(body)
        productId = created.product.id
      }
      if (productId) await api.updateProductGallery(productId, galleryToSave)
      if (productId && stockAllowed) await api.updateStock(productId, { enabled: draft.stockEnabled, quantity: Math.max(0, Number(draft.stockQuantity || 0)), variantStock: draft.variantStock || {} })
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setBusy(false) }
  }

  return <div className="modal-layer"><button className="modal-backdrop" onClick={() => void requestClose()} aria-label="Fechar editor" /><form className="editor-modal" onSubmit={save}><header><div><span>{draft.id ? 'Editar produto' : 'Novo produto'}</span><h2>{draft.id ? draft.name : 'Cadastrar produto'}</h2></div><button type="button" onClick={() => void requestClose()} aria-label="Fechar"><X size={20} /></button></header><div className="editor-scroll">
    <label><span>Vídeo ou imagem principal</span><div className="media-uploader">{draft.mediaUrl ? draft.mediaType === 'video' ? <video src={draft.mediaUrl} controls /> : <img src={draft.mediaUrl} alt="Prévia do produto" /> : <ImagePlus size={30} />}<label className="upload-button"><Upload size={16} /> {uploading ? 'Enviando…' : draft.mediaUrl ? 'Trocar arquivo' : 'Enviar arquivo'}<input type="file" accept="image/*,video/*" onChange={(e) => upload(e.target.files?.[0])} disabled={uploading} /></label></div></label>
    <section className="product-inline-section"><div className="product-inline-section__head"><div><strong>Fotos do produto</strong><span>A primeira foto é a capa. {photoLimit == null ? 'Sem limite adicional informado.' : `Até ${photoLimit} fotos no seu plano.`}</span></div><label className="secondary-action"><Upload size={15}/> Adicionar fotos<input type="file" accept="image/*" multiple hidden disabled={uploading || (photoLimit != null && gallery.length >= photoLimit)} onChange={(e) => { void uploadGallery(e.target.files); e.currentTarget.value = '' }}/></label></div>{gallery.length ? <div className="product-inline-gallery">{gallery.map((image, index) => <div key={`${image}-${index}`}><img src={image} alt={`${draft.name || 'Produto'} ${index + 1}`}/>{index === 0 && <span>Capa</span>}<div><button type="button" disabled={index === 0} onClick={() => moveGallery(index, -1)} aria-label="Mover foto para esquerda"><ChevronLeft size={14}/></button><button type="button" disabled={index === gallery.length - 1} onClick={() => moveGallery(index, 1)} aria-label="Mover foto para direita"><ChevronRight size={14}/></button><button type="button" className="danger" onClick={() => setGallery((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remover foto"><Trash2 size={14}/></button></div></div>)}</div> : <p className="product-inline-empty">Nenhuma foto adicional. Você pode adicionar várias imagens aqui.</p>}</section>
    <div className="form-grid"><label className="span-2"><span>Nome</span><input value={draft.name} onChange={(e) => update('name', e.target.value)} required /></label><label><span>Preço unitário</span><input type="number" min="0.01" step="0.01" value={draft.price} onChange={(e) => update('price', e.target.value)} required /></label><label><span>Categoria</span><input value={draft.category} onChange={(e) => update('category', e.target.value)} placeholder="Bolsas" /></label><label><span>SKU / referência</span><input value={draft.sku} onChange={(e) => update('sku', e.target.value)} /></label><label><span>Grade / embalagem</span><input value={draft.pack} onChange={(e) => update('pack', e.target.value)} placeholder="Kit 6 un. / Grade P-M-G" /></label><label className="span-2"><span>Descrição curta</span><textarea rows={3} value={draft.description} onChange={(e) => update('description', e.target.value)} /></label><label className="span-2"><span>Variações</span><textarea rows={4} value={draft.variationsText} onChange={(e) => update('variationsText', e.target.value)} placeholder={'Cor: Preto, Caramelo, Off white\nTamanho: P, M, G'} /><small>Uma linha por variação. O cliente precisará escolher antes de adicionar ao carrinho.</small></label></div>
    {stockAllowed && <section className="product-inline-section"><div className="product-inline-section__head"><div><strong>Estoque</strong><span>Controle básico deste produto. Estoque por grade continua disponível em recursos avançados.</span></div><label className="inline-switch"><input type="checkbox" checked={draft.stockEnabled} onChange={(e) => update('stockEnabled', e.target.checked)}/><span>Controlar estoque</span></label></div>{draft.stockEnabled && <label><span>Quantidade disponível</span><input type="number" min="0" step="1" value={draft.stockQuantity} onChange={(e) => update('stockQuantity', Math.max(0, Number(e.target.value) || 0))}/></label>}</section>}
    <div className="toggle-row"><label><input type="checkbox" checked={draft.featured} onChange={(e) => update('featured', e.target.checked)} /><span>Destaque / mais pedido</span></label><label><input type="checkbox" checked={draft.active} onChange={(e) => update('active', e.target.checked)} /><span>Produto visível</span></label></div>{error && <p className="form-error">{error}</p>}
  </div><footer><button type="button" className="secondary-action" onClick={() => void requestClose()}>Cancelar</button><button className="primary-action" disabled={busy || uploading}>{busy ? 'Salvando…' : 'Salvar produto'}<ArrowRight size={17} /></button></footer></form></div>
}

function SellerEditor({ draft, setDraft, storeSlug, onClose, onSaved }: { draft: Partial<AdminSeller>; setDraft: (draft: Partial<AdminSeller> | null) => void; storeSlug: string; onClose: () => void; onSaved: () => void }) {
  const [initialSnapshot] = useState(() => JSON.stringify(draft))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== initialSnapshot
  const update = (key: keyof AdminSeller, value: string | boolean) => setDraft({ ...draft, [key]: value })
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const requestClose = async () => {
    if (dirty && !(await confirmAction('Há alterações ainda não salvas nesta vendedora.', 'Descartar alterações', 'Descartar'))) return
    onClose()
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    const body = { name: draft.name, phone: draft.phone, slug: draft.slug, isActive: draft.is_active !== false }
    try { if (draft.id) await api.updateSeller(draft.id, body); else await api.createSeller(body); onSaved() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setBusy(false) }
  }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={() => void requestClose()} aria-label="Fechar editor" /><form className="seller-modal" onSubmit={save}><header><div><span>Equipe comercial</span><h2>{draft.id ? 'Editar vendedora' : 'Nova vendedora'}</h2></div><button type="button" onClick={() => void requestClose()} aria-label="Fechar"><X size={20} /></button></header><div className="editor-scroll"><label><span>Nome</span><input value={draft.name || ''} onChange={(e) => update('name', e.target.value)} required /></label><label><span>WhatsApp</span><input value={draft.phone || ''} onChange={(e) => update('phone', e.target.value)} placeholder="5511999999999" required /></label><label><span>Link individual</span><div className="url-input"><em>/{storeSlug}/</em><input value={draft.slug || ''} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="karina" /></div></label><div className="toggle-row"><label><input type="checkbox" checked={draft.is_active !== false} onChange={(e) => update('is_active', e.target.checked)} /><span>Vendedora ativa</span></label></div>{error && <p className="form-error">{error}</p>}</div><footer><button type="button" className="secondary-action" onClick={() => void requestClose()}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Salvando…' : 'Salvar vendedora'}<ArrowRight size={17} /></button></footer></form></div>
}

