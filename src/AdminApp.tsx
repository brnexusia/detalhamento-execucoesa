import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronRight, Clipboard, ExternalLink, Home, ImagePlus, LogOut, Menu, Package, Pencil, Plus, ReceiptText, Search, Settings, Store as StoreIcon, Trash2, Upload, Users, X } from 'lucide-react'
import { api } from './api'
import type { AdminBootstrap, AdminProduct, AdminSeller, VariationGroup } from './types'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type Section = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'loja'
type ProductDraft = { id?: string; name: string; sku: string; description: string; price: string; category: string; pack: string; mediaUrl: string; mediaType: 'image' | 'video'; variationsText: string; featured: boolean; active: boolean }
const blankProduct: ProductDraft = { name: '', sku: '', description: '', price: '', category: '', pack: '', mediaUrl: '', mediaType: 'image', variationsText: '', featured: false, active: true }

function go(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
function currentSection(): Section { const segment = window.location.pathname.split('/').filter(Boolean)[1]; return ['produtos', 'pedidos', 'vendedoras', 'loja'].includes(segment) ? segment as Section : 'inicio' }
function variationText(groups: VariationGroup[]) { return (groups || []).map((group) => `${group.name}: ${group.options.join(', ')}`).join('\n') }
function parseVariations(text: string): VariationGroup[] {
  return text.split('\n').map((line) => { const [name, ...rest] = line.split(':'); return { name: name?.trim() || '', options: rest.join(':').split(',').map((option) => option.trim()).filter(Boolean) } }).filter((group) => group.name && group.options.length)
}
function productDraft(product: AdminProduct): ProductDraft { return { id: product.id, name: product.name, sku: product.sku, description: product.description, price: String(product.price), category: product.category, pack: product.pack, mediaUrl: product.media_url, mediaType: product.media_type, variationsText: variationText(product.variations), featured: product.featured, active: product.active } }

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

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await api.bootstrap()) }
    catch (err) { const message = err instanceof Error ? err.message : 'Não foi possível carregar o painel.'; if (/sessão/i.test(message)) go('/entrar'); else setError(message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { const onPop = () => setSection(currentSection()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop) }, [])

  const changeSection = (next: Section) => { setSection(next); setMenuOpen(false); window.history.pushState({}, '', next === 'inicio' ? '/painel' : `/painel/${next}`) }
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('Link copiado.') }
  const logout = async () => { await api.logout().catch(() => undefined); go('/entrar') }

  if (loading) return <div className="panel-loading"><span className="brand__mark">AS</span><strong>Abrindo seu painel…</strong></div>
  if (!data) return <div className="panel-loading panel-loading--error"><span className="brand__mark">AS</span><strong>O painel não conseguiu iniciar.</strong><p>{error}</p><button className="primary-action" onClick={load}>Tentar novamente</button></div>

  const baseUrl = window.location.origin
  const storeUrl = `${baseUrl}/${data.store.slug}`
  const incomplete = data.products.length === 0 || data.sellers.length === 0 || !data.store.whatsapp

  return (
    <div className="panel-shell">
      <aside className={`panel-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="panel-brand"><span className="brand__mark">AS</span><div><strong>Atacado Shop</strong><small>{data.store.name}</small></div><button className="panel-close-menu" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        <nav className="panel-nav">
          <NavItem active={section === 'inicio'} icon={<Home size={18} />} label="Início" onClick={() => changeSection('inicio')} />
          <NavItem active={section === 'produtos'} icon={<Package size={18} />} label="Produtos" count={data.products.length} onClick={() => changeSection('produtos')} />
          <NavItem active={section === 'pedidos'} icon={<ReceiptText size={18} />} label="Pedidos" count={data.orders.length} onClick={() => changeSection('pedidos')} />
          <NavItem active={section === 'vendedoras'} icon={<Users size={18} />} label="Vendedoras" count={data.sellers.length} onClick={() => changeSection('vendedoras')} />
          <NavItem active={section === 'loja'} icon={<Settings size={18} />} label="Minha loja" onClick={() => changeSection('loja')} />
        </nav>
        <div className="panel-sidebar__foot"><a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Ver loja</a><button onClick={logout}><LogOut size={17} /> Sair</button></div>
      </aside>
      <main className="panel-main">
        <header className="panel-topbar"><button className="panel-menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><div><span>{section === 'inicio' ? 'Operação' : section}</span><strong>{section === 'inicio' ? `Olá, ${data.user.name.split(' ')[0]}.` : section[0].toUpperCase() + section.slice(1)}</strong></div><a className="panel-store-link" href={storeUrl} target="_blank" rel="noreferrer"><StoreIcon size={17} /> Abrir loja <ExternalLink size={14} /></a></header>
        {notice && <div className="toast"><Check size={16} /> {notice}</div>}
        {error && <div className="panel-error">{error}</div>}
        {section === 'inicio' && <Dashboard data={data} incomplete={incomplete} storeUrl={storeUrl} onSection={changeSection} onCopy={() => copy(storeUrl)} />}
        {section === 'produtos' && <Products data={data} query={query} setQuery={setQuery} onCreate={() => setProductModal({ ...blankProduct })} onEdit={(product) => setProductModal(productDraft(product))} onDelete={async (product) => { if (!window.confirm(`Excluir ${product.name}?`)) return; await api.deleteProduct(product.id); flash('Produto excluído.'); load() }} />}
        {section === 'pedidos' && <Orders data={data} />}
        {section === 'vendedoras' && <Sellers data={data} baseUrl={baseUrl} onCopy={copy} onCreate={() => setSellerModal({ name: '', phone: '', slug: '', is_active: true })} onEdit={(seller) => setSellerModal({ ...seller })} onDelete={async (seller) => { if (!window.confirm(`Excluir ${seller.name}?`)) return; await api.deleteSeller(seller.id); flash('Vendedora excluída.'); load() }} />}
        {section === 'loja' && <StoreSettings data={data} onSaved={() => { flash('Loja atualizada.'); load() }} onCopy={copy} />}
      </main>
      {productModal && <ProductEditor draft={productModal} setDraft={setProductModal} onClose={() => setProductModal(null)} onSaved={() => { setProductModal(null); flash(productModal.id ? 'Produto atualizado.' : 'Produto cadastrado.'); load() }} />}
      {sellerModal && <SellerEditor draft={sellerModal} setDraft={setSellerModal} storeSlug={data.store.slug} onClose={() => setSellerModal(null)} onSaved={() => { setSellerModal(null); flash(sellerModal.id ? 'Vendedora atualizada.' : 'Vendedora cadastrada.'); load() }} />}
    </div>
  )
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={active ? 'is-active' : ''} onClick={onClick}>{icon}<span>{label}</span>{typeof count === 'number' && <b>{count}</b>}</button>
}

function Dashboard({ data, incomplete, storeUrl, onSection, onCopy }: { data: AdminBootstrap; incomplete: boolean; storeUrl: string; onSection: (section: Section) => void; onCopy: () => void }) {
  return <div className="panel-page">
    {incomplete && <section className="setup-card"><div><span>Primeiros passos</span><h2>Deixe a loja pronta para receber pedidos.</h2></div><div className="setup-list"><button className={data.store.whatsapp ? 'is-done' : ''} onClick={() => onSection('loja')}><span>{data.store.whatsapp ? <Check size={16} /> : '1'}</span><div><strong>Configure a loja</strong><small>WhatsApp, pedido mínimo e endereço.</small></div><ChevronRight size={18} /></button><button className={data.products.length ? 'is-done' : ''} onClick={() => onSection('produtos')}><span>{data.products.length ? <Check size={16} /> : '2'}</span><div><strong>Cadastre produtos</strong><small>Foto ou vídeo, preço e variações.</small></div><ChevronRight size={18} /></button><button className={data.sellers.length ? 'is-done' : ''} onClick={() => onSection('vendedoras')}><span>{data.sellers.length ? <Check size={16} /> : '3'}</span><div><strong>Adicione vendedoras</strong><small>Cada uma recebe seu próprio link.</small></div><ChevronRight size={18} /></button></div></section>}
    <section className="metric-row"><div><span>Acessos</span><strong>{data.stats.views}</strong><small>na loja</small></div><div><span>Carrinhos</span><strong>{data.stats.carts}</strong><small>iniciados</small></div><div><span>Pedidos</span><strong>{data.stats.orders}</strong><small>enviados ao WhatsApp</small></div><div><span>Valor gerado</span><strong>{money.format(data.stats.value)}</strong><small>em pedidos</small></div></section>
    <section className="panel-split"><div className="plain-card"><div className="section-head"><div><span>Seu link</span><h2>Loja publicada</h2></div><a href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /></a></div><div className="copy-line"><code>{storeUrl.replace(/^https?:\/\//, '')}</code><button onClick={onCopy}><Clipboard size={16} /> Copiar</button></div><p>Use o link geral ou compartilhe o link individual de cada vendedora.</p></div><div className="plain-card"><div className="section-head"><div><span>Últimos pedidos</span><h2>{data.orders.length ? `${data.orders.length} registrados` : 'Ainda vazio'}</h2></div><button onClick={() => onSection('pedidos')}>Ver todos</button></div><div className="mini-orders">{data.orders.slice(0, 4).map((order) => <div key={order.id}><strong>{order.code}</strong><span>{order.items.length} linhas</span><b>{money.format(order.total)}</b></div>)}{!data.orders.length && <p>Os pedidos aparecem aqui antes de abrir o WhatsApp.</p>}</div></div></section>
  </div>
}

function Products({ data, query, setQuery, onCreate, onEdit, onDelete }: { data: AdminBootstrap; query: string; setQuery: (value: string) => void; onCreate: () => void; onEdit: (p: AdminProduct) => void; onDelete: (p: AdminProduct) => void }) {
  const products = data.products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="panel-page"><div className="page-title"><div><span>Catálogo</span><h1>Produtos</h1><p>O mesmo cadastro alimenta a loja e o feed.</p></div><button className="primary-action" onClick={onCreate}><Plus size={18} /> Novo produto</button></div><div className="table-toolbar"><label><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome, SKU ou categoria" /></label><span>{products.length} produtos</span></div><div className="product-admin-grid">{products.map((product) => <article className="product-admin-card" key={product.id}><div className="product-admin-card__media">{product.media_url ? product.media_type === 'video' ? <video src={product.media_url} muted /> : <img src={product.media_url} alt="" /> : <ImagePlus size={28} />}{!product.active && <span>oculto</span>}</div><div className="product-admin-card__body"><small>{product.sku || 'SEM SKU'} · {product.category}</small><h3>{product.name}</h3><strong>{money.format(product.price)}</strong>{product.variations?.length > 0 && <p>{product.variations.map((group) => `${group.name}: ${group.options.join('/')}`).join(' · ')}</p>}</div><div className="product-admin-card__actions"><button onClick={() => onEdit(product)}><Pencil size={16} /> Editar</button><button className="danger" onClick={() => onDelete(product)}><Trash2 size={16} /></button></div></article>)}</div>{!products.length && <div className="admin-empty"><Package size={30} /><h2>{data.products.length ? 'Nenhum produto encontrado.' : 'Cadastre seu primeiro produto.'}</h2><p>Você pode usar foto ou vídeo e criar variações como cor e tamanho.</p><button className="primary-action" onClick={onCreate}><Plus size={18} /> Cadastrar produto</button></div>}</div>
}

function Orders({ data }: { data: AdminBootstrap }) {
  const sellerName = (id?: string | null) => data.sellers.find((seller) => seller.id === id)?.name || 'Loja'
  return <div className="panel-page"><div className="page-title"><div><span>WhatsApp</span><h1>Pedidos</h1><p>Carrinhos registrados no momento em que o cliente envia para atendimento.</p></div></div><div className="orders-table"><div className="orders-table__head"><span>Pedido</span><span>Vendedora</span><span>Itens</span><span>Quando</span><span>Total</span></div>{data.orders.map((order) => <div className="orders-table__row" key={order.id}><strong>{order.code}</strong><span>{sellerName(order.seller_id)}</span><span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} un.</span><span>{date.format(new Date(order.created_at))}</span><b>{money.format(order.total)}</b></div>)}</div>{!data.orders.length && <div className="admin-empty"><ReceiptText size={30} /><h2>Nenhum pedido ainda.</h2><p>Quando o cliente enviar o carrinho para o WhatsApp, ele fica registrado aqui.</p></div>}</div>
}

function Sellers({ data, baseUrl, onCopy, onCreate, onEdit, onDelete }: { data: AdminBootstrap; baseUrl: string; onCopy: (value: string) => void; onCreate: () => void; onEdit: (seller: AdminSeller) => void; onDelete: (seller: AdminSeller) => void }) {
  return <div className="panel-page"><div className="page-title"><div><span>Equipe</span><h1>Vendedoras</h1><p>Cada pessoa ganha um endereço próprio da mesma loja.</p></div><button className="primary-action" onClick={onCreate}><Plus size={18} /> Nova vendedora</button></div><div className="seller-list">{data.sellers.map((seller) => { const orders = data.orders.filter((order) => order.seller_id === seller.id); const value = orders.reduce((sum, order) => sum + order.total, 0); const link = `${baseUrl}/${data.store.slug}/${seller.slug}`; return <article key={seller.id}><div className="seller-avatar">{seller.name.slice(0, 2).toUpperCase()}</div><div className="seller-main"><small>{seller.is_active ? 'ATIVA' : 'PAUSADA'}</small><h3>{seller.name}</h3><span>{seller.phone}</span></div><div className="seller-stats"><span><b>{orders.length}</b> pedidos</span><span><b>{money.format(value)}</b> gerados</span></div><div className="seller-link"><code>/{data.store.slug}/{seller.slug}</code><button onClick={() => onCopy(link)}><Clipboard size={15} /> Copiar link</button></div><div className="seller-actions"><button onClick={() => onEdit(seller)}><Pencil size={16} /></button><button className="danger" onClick={() => onDelete(seller)}><Trash2 size={16} /></button></div></article> })}</div>{!data.sellers.length && <div className="admin-empty"><Users size={30} /><h2>Cadastre quem vende.</h2><p>O link individual garante que o carrinho volte para a vendedora certa.</p><button className="primary-action" onClick={onCreate}><Plus size={18} /> Cadastrar vendedora</button></div>}</div>
}

function StoreSettings({ data, onSaved, onCopy }: { data: AdminBootstrap; onSaved: () => void; onCopy: (value: string) => void }) {
  const [form, setForm] = useState({ name: data.store.name, slug: data.store.slug, eyebrow: data.store.eyebrow, tagline: data.store.tagline, minimumOrder: String(data.store.minimum_order), whatsapp: data.store.whatsapp, logoUrl: data.store.logo_url, accent: data.store.accent })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const url = `${window.location.origin}/${form.slug}`
  const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { await api.updateStore(form); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') } finally { setBusy(false) } }
  return <div className="panel-page"><div className="page-title"><div><span>Publicação</span><h1>Minha loja</h1><p>Só o necessário para sua vitrine ficar com a sua cara.</p></div></div><form className="settings-layout" onSubmit={save}><section className="settings-card"><h2>Identidade</h2><label><span>Nome da loja</span><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></label><label><span>Frase pequena</span><input value={form.eyebrow} onChange={(e) => update('eyebrow', e.target.value)} placeholder="Atacado de moda feminina" /></label><label><span>Chamada da capa</span><textarea value={form.tagline} onChange={(e) => update('tagline', e.target.value)} rows={3} /></label><label><span>Logo (URL)</span><input value={form.logoUrl} onChange={(e) => update('logoUrl', e.target.value)} placeholder="https://…" /></label><label className="color-field"><span>Cor principal</span><div><input type="color" value={form.accent} onChange={(e) => update('accent', e.target.value)} /><code>{form.accent}</code></div></label></section><section className="settings-card"><h2>Venda</h2><label><span>Pedido mínimo</span><input type="number" step="0.01" min="0" value={form.minimumOrder} onChange={(e) => update('minimumOrder', e.target.value)} /></label><label><span>WhatsApp padrão</span><input value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="5511999999999" /></label><h2 className="settings-subtitle">Endereço</h2><label><span>URL da loja</span><div className="url-input"><em>{window.location.host}/</em><input value={form.slug} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div></label><div className="copy-line"><code>{url.replace(/^https?:\/\//, '')}</code><button type="button" onClick={() => onCopy(url)}><Clipboard size={16} /> Copiar</button></div></section><div className="settings-save">{error && <p className="form-error">{error}</p>}<button className="primary-action" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}<ArrowRight size={18} /></button></div></form></div>
}

function ProductEditor({ draft, setDraft, onClose, onSaved }: { draft: ProductDraft; setDraft: (draft: ProductDraft | null) => void; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState('')
  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft({ ...draft, [key]: value })
  const upload = async (file?: File) => { if (!file) return; setUploading(true); setError(''); try { const result = await api.upload(file); setDraft({ ...draft, mediaUrl: result.url, mediaType: result.type }) } catch (err) { setError(err instanceof Error ? err.message : 'Falha no upload.') } finally { setUploading(false) } }
  const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); const body = { name: draft.name, sku: draft.sku, description: draft.description, price: Number(draft.price), category: draft.category, pack: draft.pack, mediaUrl: draft.mediaUrl, mediaType: draft.mediaType, variations: parseVariations(draft.variationsText), featured: draft.featured, active: draft.active }; try { if (draft.id) await api.updateProduct(draft.id, body); else await api.createProduct(body); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') } finally { setBusy(false) } }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} /><form className="editor-modal" onSubmit={save}><header><div><span>{draft.id ? 'Editar produto' : 'Novo produto'}</span><h2>{draft.id ? draft.name : 'Cadastrar produto'}</h2></div><button type="button" onClick={onClose}><X size={20} /></button></header><div className="editor-scroll"><label><span>Foto ou vídeo</span><div className="media-uploader">{draft.mediaUrl ? draft.mediaType === 'video' ? <video src={draft.mediaUrl} controls /> : <img src={draft.mediaUrl} alt="" /> : <ImagePlus size={30} />}<label className="upload-button"><Upload size={16} /> {uploading ? 'Enviando…' : draft.mediaUrl ? 'Trocar arquivo' : 'Enviar arquivo'}<input type="file" accept="image/*,video/*" onChange={(e) => upload(e.target.files?.[0])} disabled={uploading} /></label></div></label><div className="form-grid"><label className="span-2"><span>Nome</span><input value={draft.name} onChange={(e) => update('name', e.target.value)} required /></label><label><span>Preço unitário</span><input type="number" min="0.01" step="0.01" value={draft.price} onChange={(e) => update('price', e.target.value)} required /></label><label><span>Categoria</span><input value={draft.category} onChange={(e) => update('category', e.target.value)} placeholder="Bolsas" /></label><label><span>SKU / referência</span><input value={draft.sku} onChange={(e) => update('sku', e.target.value)} /></label><label><span>Grade / embalagem</span><input value={draft.pack} onChange={(e) => update('pack', e.target.value)} placeholder="Kit 6 un. / Grade P-M-G" /></label><label className="span-2"><span>Descrição curta</span><textarea rows={3} value={draft.description} onChange={(e) => update('description', e.target.value)} /></label><label className="span-2"><span>Variações</span><textarea rows={4} value={draft.variationsText} onChange={(e) => update('variationsText', e.target.value)} placeholder={'Cor: Preto, Caramelo, Off white\nTamanho: P, M, G'} /><small>Uma linha por variação. O cliente precisará escolher antes de adicionar ao carrinho.</small></label></div><div className="toggle-row"><label><input type="checkbox" checked={draft.featured} onChange={(e) => update('featured', e.target.checked)} /><span>Destaque / mais pedido</span></label><label><input type="checkbox" checked={draft.active} onChange={(e) => update('active', e.target.checked)} /><span>Produto visível</span></label></div>{error && <p className="form-error">{error}</p>}</div><footer><button type="button" className="secondary-action" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy || uploading}>{busy ? 'Salvando…' : 'Salvar produto'}<ArrowRight size={17} /></button></footer></form></div>
}

function SellerEditor({ draft, setDraft, storeSlug, onClose, onSaved }: { draft: Partial<AdminSeller>; setDraft: (draft: Partial<AdminSeller> | null) => void; storeSlug: string; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const update = (key: keyof AdminSeller, value: string | boolean) => setDraft({ ...draft, [key]: value })
  const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); const body = { name: draft.name, phone: draft.phone, slug: draft.slug, isActive: draft.is_active !== false }; try { if (draft.id) await api.updateSeller(draft.id, body); else await api.createSeller(body); onSaved() } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') } finally { setBusy(false) } }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} /><form className="seller-modal" onSubmit={save}><header><div><span>Equipe comercial</span><h2>{draft.id ? 'Editar vendedora' : 'Nova vendedora'}</h2></div><button type="button" onClick={onClose}><X size={20} /></button></header><div className="editor-scroll"><label><span>Nome</span><input value={draft.name || ''} onChange={(e) => update('name', e.target.value)} required /></label><label><span>WhatsApp</span><input value={draft.phone || ''} onChange={(e) => update('phone', e.target.value)} placeholder="5511999999999" required /></label><label><span>Link individual</span><div className="url-input"><em>/{storeSlug}/</em><input value={draft.slug || ''} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="karina" /></div></label><div className="toggle-row"><label><input type="checkbox" checked={draft.is_active !== false} onChange={(e) => update('is_active', e.target.checked)} /><span>Vendedora ativa</span></label></div>{error && <p className="form-error">{error}</p>}</div><footer><button type="button" className="secondary-action" onClick={onClose}>Cancelar</button><button className="primary-action" disabled={busy}>{busy ? 'Salvando…' : 'Salvar vendedora'}<ArrowRight size={17} /></button></footer></form></div>
}
