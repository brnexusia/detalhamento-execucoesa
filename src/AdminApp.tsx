import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Boxes, Check, ChevronLeft, ChevronRight, Clipboard, CreditCard, Download, Eye, EyeOff, ExternalLink, ImagePlus, Link2, LogOut, Menu, MoreHorizontal, Package, Pencil, Plus, ReceiptText, Search, Settings, Store as StoreIcon, Trash2, TrendingUp, Upload, Users, X } from 'lucide-react'
import { api } from './api'
import { listenAuthChanges } from './auth-session-sync'
import ShopvaxDashboard from './ShopvaxDashboard'
import ShopvaxLoading from './ShopvaxLoading'
import ShopvaxPanelMark from './ShopvaxPanelMark'
import ShopvaxFirstRun from './ShopvaxFirstRun'
import ShopvaxThemesPanel from './ShopvaxThemesPanel'
import ShopvaxOrders from './ShopvaxOrders'
import AdminNavigation from './AdminNavigation'
import CommercialSettingsPanel from './CommercialSettingsPanel'
import { confirmAction } from './ui-dialogs'
import { confirmNavigationIfDirty } from './unsaved-changes'
import type { AdminBootstrap, AdminProduct, AdminSeller, VariationGroup } from './types'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
type Section = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'loja' | 'temas'
type ProductDraft = { id?: string; name: string; sku: string; description: string; price: string; category: string; pack: string; mediaUrl: string; mediaType: 'image' | 'video'; images: string[]; variationsText: string; featured: boolean; active: boolean; stockEnabled: boolean; stockQuantity: number; variantStock: Record<string, number> }
const blankProduct: ProductDraft = { name: '', sku: '', description: '', price: '', category: '', pack: '', mediaUrl: '', mediaType: 'image', images: [], variationsText: '', featured: false, active: true, stockEnabled: false, stockQuantity: 0, variantStock: {} }

function go(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function currentSection(): Section { const segment = window.location.pathname.split('/').filter(Boolean)[1]; return ['produtos', 'pedidos', 'vendedoras', 'loja', 'temas'].includes(segment) ? segment as Section : 'inicio' }
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
  const [skipFirstRun, setSkipFirstRun] = useState(false)
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [productModal, setProductModal] = useState<ProductDraft | null>(null)
  const [sellerModal, setSellerModal] = useState<Partial<AdminSeller> | null>(null)
  const [query, setQuery] = useState('')
  const [productsVersion, setProductsVersion] = useState(0)
  const [visitedProducts, setVisitedProducts] = useState(section === 'produtos')
  const [storeDirty, setStoreDirty] = useState(false)
  const loadVersion = useRef(0)

  const load = async (silent = false) => {
    const version = ++loadVersion.current
    if (!silent) setLoading(true)
    setError('')
    try {
      const next = await api.bootstrapCompact()
      if (version === loadVersion.current) setData(next)
    } catch (err) {
      if (version !== loadVersion.current) return
      const message = err instanceof Error ? err.message : 'Não foi possível carregar o painel.'
      setData(null)
      if ((err as Error & { status?: number }).status === 402) go('/painel/assinatura')
      else if ((err as Error & { status?: number }).status === 401 || /sessão/i.test(message)) go('/entrar')
      else setError(message)
    } finally {
      if (version === loadVersion.current && !silent) setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // Os cookies são compartilhados: uma aba não pode mostrar dados antigos após login/logout em outra.
    const refreshIdentity = () => {
      setData(null)
      setProductModal(null)
      setSellerModal(null)
      setSkipFirstRun(false)
      void load()
    }
    const unsubscribe = listenAuthChanges('owner', refreshIdentity)
    const onFocus = () => { if (document.visibilityState === 'visible') refreshIdentity() }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      loadVersion.current += 1
    }
  }, [])
  useEffect(() => { const onPop = () => setSection(currentSection()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop) }, [])
  useEffect(() => { if (section === 'produtos') setVisitedProducts(true) }, [section])
  const refreshCatalog = () => {
    setProductsVersion((version) => version + 1)
    void load(true) // Compact metadata only; the product grid fetches its own page.
  }
  useEffect(() => {
    window.addEventListener('shopvax:catalog-changed', refreshCatalog)
    return () => window.removeEventListener('shopvax:catalog-changed', refreshCatalog)
    // Refresh reads only the current session and stable loadVersion ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canLeaveStore = async () => section !== 'loja' || !storeDirty || await confirmAction('Você tem alterações não salvas. Deseja sair sem salvar?', 'Descartar alterações', 'Sair sem salvar')
  const changeSection = async (next: Section) => { if (next !== section && !(await canLeaveStore())) return; setStoreDirty(false); setSection(next); setMenuOpen(false); window.history.pushState({}, '', next === 'inicio' ? '/painel' : `/painel/${next}`) }
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('Link copiado.') }
  const logout = async () => {
    if (!(await canLeaveStore())) return
    try {
      await api.logout()
      setData(null)
      go('/entrar')
    } catch {
      setError('Não foi possível encerrar a sessão. Tente novamente.')
    }
  }
  const deleteProductsBulk = async (ids: string[]) => {
    if (!ids.length) return false
    const label = countLabel(ids.length, 'produto selecionado', 'produtos selecionados')
    if (!(await confirmAction(`Excluir ${label}? Esta ação não pode ser desfeita.`, 'Excluir produtos em massa', 'Excluir selecionados'))) return false
    setError('')
    try {
      const result = await api.deleteProducts(ids)
      flash(countLabel(result.deleted, 'produto excluído', 'produtos excluídos'))
      refreshCatalog()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir os produtos selecionados.')
      return false
    }
  }
  const downloadProductsPdf = async () => {
    setError('')
    try {
      const file = await api.downloadProductsPdf()
      downloadFile(file.blob, file.filename)
      flash('Catálogo PDF gerado.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o catálogo PDF.')
      throw err
    }
  }

  if (loading) return <ShopvaxLoading label="Abrindo seu painel…" />
  if (!data) return <div className="panel-loading panel-loading--error"><span className="brand__mark"><img src="/brand/shopvax-symbol-dark.svg" className="svx-brand-symbol" alt="" aria-hidden="true" /></span><strong>O painel não conseguiu iniciar.</strong><p>{error}</p><button className="primary-action" onClick={() => { void load() }}>Tentar novamente</button></div>

  const baseUrl = window.location.origin
  const storeUrl = `${baseUrl}/${data.store.slug}`
  const totalProducts = data.productCount ?? data.products.length
  const incomplete = totalProducts === 0 || data.sellers.length === 0 || !data.store.whatsapp

  return (
    <div className="panel-shell">
      <aside className={`panel-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="panel-brand"><ShopvaxPanelMark /><div className="panel-brand__identity"><strong className="panel-brand__wordmark"><img className="svx-brand-wordmark" src="/brand/shopvax-wordmark-light.svg" alt="Shopvax" /></strong><small className="panel-brand__username" title={data.user.name}>{data.user.name}</small></div><button className="panel-close-menu" onClick={() => setMenuOpen(false)}><X size={18} /></button></div>
        <AdminNavigation
          active={section}
          counts={{ products: totalProducts, orders: data.orders.length, sellers: data.sellers.length }}
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
        {section === 'inicio' && (data.store.onboarding_palette_selected === false && !totalProducts && !skipFirstRun && sessionStorage.getItem('shopvax:firstrun-skip:' + data.store.id) !== '1' ? <ShopvaxFirstRun storeName={data.store.name} initialAccent={data.store.accent} onSave={async (accent) => { await api.updateStore({ accent, completePaletteSetup: true }); await load() }} onSkip={() => { sessionStorage.setItem('shopvax:firstrun-skip:' + data.store.id, '1'); setSkipFirstRun(true) }} onOpenThemes={() => { sessionStorage.setItem('shopvax:firstrun-skip:' + data.store.id, '1'); setSkipFirstRun(true); void changeSection('temas') }} /> : <Dashboard data={data} incomplete={incomplete} storeUrl={storeUrl} onSection={changeSection} onCopy={copy} />)}
        {(section === 'produtos' || visitedProducts) && <div hidden={section !== 'produtos'}><Products data={data} revision={productsVersion} query={query} setQuery={setQuery} onCreate={() => setProductModal({ ...blankProduct })} onEdit={(product) => setProductModal(productDraft(product))} onVisibility={async (product) => { await api.setProductVisibility(product.id, !product.active); flash(product.active ? 'Produto escondido da loja e do feed.' : 'Produto publicado novamente.'); refreshCatalog() }} onDelete={async (product) => { if (!(await confirmAction(`Excluir ${product.name}? Esta ação não pode ser desfeita.`, 'Excluir produto', 'Excluir'))) return; await api.deleteProduct(product.id); flash('Produto excluído.'); refreshCatalog() }} onBulkDelete={deleteProductsBulk} onDownloadPdf={downloadProductsPdf} /></div>}
        {section === 'pedidos' && <Orders data={data} onUpdated={load} />}
        {section === 'vendedoras' && <Sellers data={data} baseUrl={baseUrl} onCopy={copy} onCreate={() => setSellerModal({ name: '', phone: '', slug: '', is_active: true })} onEdit={(seller) => setSellerModal({ ...seller })} onDelete={async (seller) => { if (!(await confirmAction(`Excluir ${seller.name}? O link individual deixará de funcionar.`, 'Excluir vendedora', 'Excluir'))) return; await api.deleteSeller(seller.id); flash('Vendedora excluída.'); load() }} />}
        {section === 'temas' && <ShopvaxThemesPanel data={data} onSaved={() => { flash('Tema e paleta atualizados.'); void load(true) }} />}
         {section === 'loja' && <><StoreSettings data={data} onSaved={() => { flash('Loja atualizada.'); load() }} onCopy={copy} onDirtyChange={setStoreDirty} /><CommercialSettingsPanel embedded/><StoreTools data={data}/></>}
      </main>
      {productModal && <ProductEditor draft={productModal} setDraft={setProductModal} onClose={() => setProductModal(null)} onSaved={() => { setProductModal(null); flash(productModal.id ? 'Produto atualizado.' : 'Produto cadastrado.'); refreshCatalog() }} />}
      {sellerModal && <SellerEditor draft={sellerModal} setDraft={setSellerModal} storeSlug={data.store.slug} onClose={() => setSellerModal(null)} onSaved={() => { setSellerModal(null); flash(sellerModal.id ? 'Vendedora atualizada.' : 'Vendedora cadastrada.'); load() }} />}
    </div>
  )
}

function Dashboard({ data, incomplete, storeUrl, onSection, onCopy }: { data: AdminBootstrap; incomplete: boolean; storeUrl: string; onSection: (section: Section) => void; onCopy: (url: string) => void }) {
  return <ShopvaxDashboard data={data} incomplete={incomplete} storeUrl={storeUrl} onSection={onSection} onCopy={onCopy}/>
}

function Products({ data, revision, query, setQuery, onCreate, onEdit, onVisibility, onDelete, onBulkDelete, onDownloadPdf }: { data: AdminBootstrap; revision: number; query: string; setQuery: (value: string) => void; onCreate: () => void; onEdit: (p: AdminProduct) => void; onVisibility: (p: AdminProduct) => void | Promise<void>; onDelete: (p: AdminProduct) => void; onBulkDelete: (ids: string[]) => Promise<boolean>; onDownloadPdf: () => Promise<void> }) {
  const [page, setPage] = useState(1)
  const [activeCategory, setActiveCategory] = useState('Todas')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [visibilityBusy, setVisibilityBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const pageSize = 18
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [total, setTotal] = useState(0)
  const [pageBusy, setPageBusy] = useState(true)
  const [pageError, setPageError] = useState('')
  const [retry, setRetry] = useState(0)
  const [searchTerm, setSearchTerm] = useState(query)
  const storeTotal = data.productCount ?? data.products.length
  const categories = data.productCategories || []
  const visible = query !== searchTerm || pageError ? [] : products
  const selected = new Set(selectedIds)
  const allLoadedSelected = visible.length > 0 && visible.every((product) => selected.has(product.id))

  useEffect(() => { window.dispatchEvent(new Event('shopvax:products-ready')) }, [])
  useEffect(() => { setPage(1); setProducts([]); setSelectedIds([]) }, [query, activeCategory, revision])
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchTerm(query), 250)
    return () => window.clearTimeout(timeout)
  }, [query])
  useEffect(() => {
    let active = true
    setPageBusy(true)
    setPageError('')
    void api.listAdminProducts({ page, limit: pageSize, q: searchTerm, category: activeCategory })
      .then((response) => {
        if (!active) return
        setProducts((previous) => page === 1 ? response.products : [
          ...previous,
          ...response.products.filter((item) => !previous.some((present) => present.id === item.id)),
        ])
        setTotal(response.pagination.total)
      })
      .catch((err) => { if (active) setPageError(err instanceof Error ? err.message : 'Falha ao carregar produtos.') })
      .finally(() => { if (active) setPageBusy(false) })
    return () => { active = false }
  }, [page, searchTerm, activeCategory, revision, data.store.id, retry])

  const toggleSelectionMode = () => { setSelectionMode((current) => !current); setSelectedIds([]) }
  const toggleProduct = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const toggleLoaded = () => {
    const ids = visible.map((item) => item.id)
    setSelectedIds((current) => allLoadedSelected ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids])))
  }
  const removeSelected = async () => {
    if (!selectedIds.length || bulkBusy || selectedIds.length > 5000) return
    setBulkBusy(true)
    try {
      const deleted = await onBulkDelete(selectedIds)
      if (deleted) { setSelectedIds([]); setSelectionMode(false) }
    } finally { setBulkBusy(false) }
  }
  const generatePdf = async () => {
    if (pdfBusy || !storeTotal) return
    setPdfBusy(true)
    try { await onDownloadPdf() } catch { /* The parent displays the failed PDF request. */ }
    finally { setPdfBusy(false) }
  }
  const toggleVisibility = async (product: AdminProduct) => {
    if (visibilityBusy) return
    setVisibilityBusy(product.id)
    setActionError('')
    try { await onVisibility(product) }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Não foi possível alterar a visibilidade do produto.') }
    finally { setVisibilityBusy(null) }
  }
  const gradeLabel = (product: AdminProduct) => {
    const groups = product.variations || []
    if (!groups.length) return product.pack || '—'
    const color = groups.find((item) => /^(cor|cores|color|colors|tonalidade)s?$/i.test(item.name.trim()))
    const other = groups.filter((item) => item !== color)
    const labels = []
    if (color) labels.push(String(color.options.length) + (color.options.length === 1 ? ' cor' : ' cores'))
    for (const group of other) {
      const choices = group.options.join(' · ')
      labels.push(/^(tamanho|tamanhos|size|sizes)$/i.test(group.name.trim()) ? choices : group.name + ': ' + choices)
    }
    return labels.join(' · ') || product.pack || '—'
  }
  const numberPrice = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return <div className="panel-page svx-products">
    <header className="page-title svx-products__hero">
      <div className="svx-products__intro">
        <span className="svx-products__eyebrow">{storeTotal} PRODUTOS{data.activeProductCount == null ? '' : ' · ' + data.activeProductCount + ' APARECEM NA LOJA'}</span>
        <h1>Produtos</h1>
      </div>
      <div className="page-title-actions svx-products__top-actions">
        <button type="button" className="svx-products__text-action" disabled={!storeTotal || pdfBusy} onClick={() => void generatePdf()}><Download size={15} />{pdfBusy ? 'Gerando PDF…' : 'Catálogo em PDF'}</button>
        <button type="button" className="primary-action" onClick={onCreate}>Novo produto <ArrowRight size={18} /></button>
      </div>
    </header>
    <div className="svx-products__toolbar">
      <nav className="svx-products__categories" aria-label="Filtrar produtos por categoria">
        <button type="button" aria-pressed={activeCategory === 'Todas'} className={activeCategory === 'Todas' ? 'is-active' : ''} onClick={() => setActiveCategory('Todas')}>Todos <small>{storeTotal}</small></button>
        {categories.map((item) => <button type="button" key={item.category} aria-pressed={activeCategory === item.category} className={activeCategory === item.category ? 'is-active' : ''} onClick={() => setActiveCategory(item.category)}>{item.category} <small>{item.count}</small></button>)}
      </nav>
      <label className="svx-products__search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou referência" aria-label="Buscar produto por nome, referência ou categoria" /></label>
    </div>
    {selectionMode && <div className="product-bulk-toolbar">
      <label><input type="checkbox" checked={allLoadedSelected} onChange={toggleLoaded} disabled={!visible.length} /><span>Selecionar os {visible.length} produtos carregados</span></label>
      <div><span>{countLabel(selectedIds.length, 'selecionado')}</span><button type="button" className="secondary-action danger" disabled={!selectedIds.length || bulkBusy || selectedIds.length > 5000} onClick={() => void removeSelected()}><Trash2 size={15}/>{bulkBusy ? 'Excluindo…' : 'Excluir selecionados'}</button></div>
    </div>}
    {actionError && <div className="panel-error" role="alert">{actionError}<button type="button" onClick={() => setActionError('')}>Fechar</button></div>}
    <div className="svx-products__table" role="table" aria-label="Produtos cadastrados" aria-busy={pageBusy}>
      <div className="svx-products__headings" role="row">
        <span role="columnheader">Produto</span><span role="columnheader">Categoria</span><span role="columnheader">Grade</span><span role="columnheader">Preço</span><span role="columnheader">Na loja</span><span role="columnheader">Ações</span>
      </div>
      {visible.map((product) => <article role="row" className={'product-admin-card' + (selected.has(product.id) ? ' is-selected' : '')} key={product.id}>
        <div className="svx-products__product" role="cell">
          {selectionMode && <label className="product-select-control"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleProduct(product.id)} /><span className="sr-only">Selecionar {product.name}</span></label>}
          <div className="product-admin-card__media"><AdminProductMedia product={product}/></div>
          <div className="svx-products__name-ref"><div className="svx-products__name-line"><strong>{product.name}</strong>{product.featured && <span className="svx-products__featured">Destaque</span>}</div><small>{product.sku ? 'REF ' + product.sku : 'SEM REFERÊNCIA'}</small></div>
        </div>
        <div className="svx-products__category" role="cell"><span className="svx-products__mobile-label">Categoria</span>{product.category || 'Geral'}</div>
        <div className="svx-products__grade" role="cell"><span className="svx-products__mobile-label">Grade</span>{gradeLabel(product)}</div>
        <div className="svx-products__price" role="cell"><span className="svx-products__mobile-label">Preço</span><small>R$</small><strong>{numberPrice.format(product.price)}</strong></div>
        <div className="svx-products__visibility" role="cell"><button type="button" className="svx-products__switch" role="switch" aria-checked={product.active} aria-label={(product.active ? 'Ocultar ' : 'Mostrar ') + product.name + ' na loja'} disabled={visibilityBusy !== null} onClick={() => void toggleVisibility(product)}><span className="svx-products__track" aria-hidden="true"><span /></span><span>{visibilityBusy === product.id ? 'Salvando…' : product.active ? 'Visível' : 'Oculto'}</span></button></div>
        <div className="svx-products__actions" role="cell"><button type="button" className="svx-products__edit" onClick={() => onEdit(product)}>Editar</button><details className="svx-products__more"><summary aria-label={'Mais ações de ' + product.name} title="Mais ações"><MoreHorizontal size={18} aria-hidden="true" /></summary><button type="button" className="svx-products__delete" onClick={() => onDelete(product)}><Trash2 size={14} /> Excluir</button></details></div>
      </article>)}
    </div>
    {pageError && <div className="panel-error" role="alert">{pageError}<button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
    {(pageBusy || query !== searchTerm) && !visible.length && <ShopvaxLoading compact label="Carregando produtos…" />}
    {!pageBusy && query === searchTerm && !pageError && !visible.length && <div className="admin-empty"><Package size={30}/><h2>{storeTotal ? 'Nenhum produto encontrado.' : 'Cadastre seu primeiro produto.'}</h2><p>Você pode usar fotos ou vídeo, criar variações e controlar estoque na mesma edição.</p><button className="primary-action" onClick={onCreate}><Plus size={18} /> Cadastrar produto</button></div>}
    {(total > 0 || storeTotal > 0) && <footer className="svx-products__footer"><span>{visible.length} DE {total} PRODUTOS</span><div><button type="button" className="svx-products__select" disabled={!visible.length || bulkBusy} onClick={toggleSelectionMode}>{selectionMode ? 'Cancelar seleção' : 'Selecionar produtos'}</button>{visible.length < total && <button type="button" className="svx-products__load-more" disabled={pageBusy || !!pageError} onClick={() => setPage((value) => value + 1)}>{pageBusy ? 'Carregando…' : 'Ver mais produtos'}</button>}</div></footer>}
  </div>
}


function Orders({ data, onUpdated }: { data: AdminBootstrap; onUpdated: () => void | Promise<void> }) {
  return <ShopvaxOrders data={data} onUpdated={onUpdated}/>
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

  return <div className="panel-page"><div className="page-title"><div><span>Publicação</span><h1>Minha loja</h1><p>Só o necessário para sua vitrine ficar com a sua cara.</p></div></div><form className="settings-layout settings-layout--ux" onSubmit={save}><section className="settings-card"><h2>Identidade</h2><label><span>Nome da loja</span><input value={form.name} onChange={(e) => update('name', e.target.value)} required /></label><label><span>Frase pequena</span><input value={form.eyebrow} onChange={(e) => update('eyebrow', e.target.value)} placeholder="Atacado de moda feminina" /></label><label><span>Chamada da capa</span><textarea value={form.tagline} onChange={(e) => update('tagline', e.target.value)} rows={3} /></label><label><span>Logo</span><div className="logo-upload-control"><div className="logo-upload-preview">{form.logoUrl ? <img src={form.logoUrl} alt="Prévia da logo" /> : <span>LOGO</span>}</div><div><label className="logo-upload-button"><Upload size={16} /> {uploadingLogo ? 'Enviando…' : form.logoUrl ? 'Trocar logo' : 'Enviar logo'}<input type="file" accept="image/*" onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.currentTarget.value = '' }} disabled={uploadingLogo} /></label><p className="logo-upload-help">Escolha a imagem direto do celular ou computador.</p></div></div></label></section><section className="settings-card"><h2>Venda</h2><label><span>Pedido mínimo</span><div className="money-input"><span>R$</span><input type="number" step="0.01" min="0" value={form.minimumOrder} onChange={(e) => update('minimumOrder', e.target.value)} /></div></label><label><span>WhatsApp padrão</span><div className="whatsapp-input"><input value={form.whatsapp} inputMode="tel" onChange={(e) => update('whatsapp', formatWhatsapp(e.target.value))} placeholder="+55 (11) 99197-2120" /></div><small className="field-help">DDD e número completo. O sistema valida antes de salvar.</small></label><h2 className="settings-subtitle">Link da loja</h2><label><span>URL da loja</span><div className="url-input"><em>{window.location.host}/</em><input value={form.slug} onChange={(e) => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div></label><div className="copy-line"><code>{url.replace(/^https?:\/\//, '')}</code><button type="button" onClick={() => onCopy(url)}><Clipboard size={16} /> Copiar</button></div><div className="checkout-visibility-note"><strong>Frete e forma de pagamento</strong><p>Continuam sendo combinados com o cliente no WhatsApp depois que o carrinho é enviado para a vendedora.</p></div></section><section className="settings-card store-preview-card" style={{ '--preview-accent': form.accent } as React.CSSProperties}><h2>Prévia da loja</h2><div className="store-preview-head"><div className="store-preview-logo">{form.logoUrl ? <img src={form.logoUrl} alt="" /> : <span>{(form.name || 'L').trim().slice(0, 1).toUpperCase()}</span>}</div><strong>{form.name || 'Sua loja'}</strong></div><div className="store-preview-body"><span>{form.eyebrow || 'Atacado'}</span><p>{form.tagline || 'Sua chamada principal aparece aqui.'}</p></div></section><div className="settings-save settings-save--sticky">{dirty && <span className="unsaved-indicator">Alterações não salvas</span>}{error && <p className="form-error">{error}</p>}<button className={`primary-action ${dirty ? 'has-changes' : ''}`} disabled={busy || uploadingLogo || !dirty}>{busy ? 'Salvando…' : 'Salvar alterações'}<ArrowRight size={18} /></button></div></form></div>
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
    <label><span>Vídeo ou imagem principal</span><div className="media-uploader">{draft.mediaUrl ? draft.mediaType === 'video' ? <video src={draft.mediaUrl} controls /> : <img src={draft.mediaUrl} alt="Prévia do produto" /> : <ImagePlus size={30} />}<label className="upload-button"><Upload size={16} /> {uploading ? 'Enviando…' : draft.mediaUrl ? 'Trocar arquivo' : 'Enviar arquivo'}<input type="file" accept="image/*,video/*" onChange={(e) => { void upload(e.target.files?.[0]); e.currentTarget.value = '' }} disabled={uploading} /></label></div></label>
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

