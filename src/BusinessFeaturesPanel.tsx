import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Boxes, Check, Copy, Plus, RefreshCcw, Save, Trash2, XCircle } from 'lucide-react'
import { api, type AdminCatalog } from './api'
import type { AdminBootstrap, AdminProduct, VariationGroup } from './types'
import './business-features.css'

type StockDraft = { enabled: boolean; quantity: number; variantStock: Record<string, number> }
type CatalogDraft = { name: string; kind: 'geral' | 'atacado' | 'varejo'; minimumOrder: string; active: boolean; items: Record<string, { visible: boolean; priceOverride: string }> }

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function keyOf(selections: Record<string, string>) {
  return Object.entries(selections).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([key, value]) => `${key}=${value}`).join('|')
}

function combinations(groups: VariationGroup[]) {
  const valid = (groups || []).filter((group) => group.name && group.options?.length)
  if (!valid.length) return [] as Array<Record<string, string>>
  let rows: Array<Record<string, string>> = [{}]
  for (const group of valid) rows = rows.flatMap((row) => group.options.map((option) => ({ ...row, [group.name]: option }))).slice(0, 300)
  return rows
}

function initialDraft(product: AdminProduct): StockDraft {
  return { enabled: Boolean(product.stock_enabled), quantity: Math.max(0, Number(product.stock_quantity || 0)), variantStock: { ...(product.variant_stock || {}) } }
}

function catalogDraft(catalog: AdminCatalog, products: AdminProduct[]): CatalogDraft {
  const mapped = new Map(catalog.items.map((item) => [item.productId, item]))
  return {
    name: catalog.name,
    kind: catalog.kind,
    minimumOrder: catalog.minimumOrder == null ? '' : String(catalog.minimumOrder),
    active: catalog.active,
    items: Object.fromEntries(products.map((product) => {
      const item = mapped.get(product.id)
      return [product.id, { visible: item?.visible !== false, priceOverride: item?.priceOverride == null ? '' : String(item.priceOverride) }]
    })),
  }
}

export default function BusinessFeaturesPanel() {
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [catalogs, setCatalogs] = useState<AdminCatalog[]>([])
  const [drafts, setDrafts] = useState<Record<string, StockDraft>>({})
  const [catalogDrafts, setCatalogDrafts] = useState<Record<string, CatalogDraft>>({})
  const [newCatalog, setNewCatalog] = useState({ name: '', kind: 'atacado' as 'atacado' | 'varejo' | 'geral', minimumOrder: '' })
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [next, catalogResult] = await Promise.all([api.bootstrap(), api.catalogs()])
      setData(next)
      setCatalogs(catalogResult.catalogs)
      setDrafts(Object.fromEntries(next.products.map((product) => [product.id, initialDraft(product)])))
      setCatalogDrafts(Object.fromEntries(catalogResult.catalogs.map((catalog) => [catalog.id, catalogDraft(catalog, next.products)])))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar os recursos.') }
  }

  useEffect(() => { void load() }, [])
  const controlled = useMemo(() => data?.products.filter((product) => drafts[product.id]?.enabled).length || 0, [data, drafts])
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }

  const saveStock = async (product: AdminProduct) => {
    const draft = drafts[product.id]
    if (!draft) return
    setSaving(product.id); setError('')
    try { await api.updateStock(product.id, draft); flash(`Estoque de ${product.name} atualizado.`); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o estoque.') }
    finally { setSaving('') }
  }

  const cancel = async (orderId: string) => {
    if (!window.confirm('Cancelar este pedido e devolver o estoque correspondente?')) return
    setSaving(orderId); setError('')
    try { const result = await api.cancelOrder(orderId); flash(result.idempotent ? 'Esse pedido já estava cancelado.' : 'Pedido cancelado e estoque devolvido.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cancelar o pedido.') }
    finally { setSaving('') }
  }

  const createCatalog = async () => {
    if (!newCatalog.name.trim()) return setError('Informe o nome do catálogo.')
    setSaving('new-catalog'); setError('')
    try {
      await api.createCatalog({ name: newCatalog.name.trim(), kind: newCatalog.kind, minimumOrder: newCatalog.minimumOrder === '' ? null : Number(newCatalog.minimumOrder) })
      setNewCatalog({ name: '', kind: 'atacado', minimumOrder: '' })
      flash('Catálogo criado.'); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o catálogo.') }
    finally { setSaving('') }
  }

  const saveCatalog = async (catalog: AdminCatalog) => {
    const draft = catalogDrafts[catalog.id]
    if (!draft) return
    setSaving(catalog.id); setError('')
    try {
      await api.updateCatalog(catalog.id, {
        name: draft.name,
        kind: draft.kind,
        minimumOrder: draft.minimumOrder === '' ? null : Number(draft.minimumOrder),
        active: draft.active,
        items: Object.entries(draft.items).map(([productId, item]) => ({ productId, visible: item.visible, priceOverride: item.priceOverride === '' ? null : Number(item.priceOverride) })),
      })
      flash(`Catálogo ${draft.name} atualizado.`); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o catálogo.') }
    finally { setSaving('') }
  }

  const removeCatalog = async (catalog: AdminCatalog) => {
    if (catalog.isDefault || !window.confirm(`Excluir o catálogo ${catalog.name}?`)) return
    setSaving(catalog.id)
    try { await api.deleteCatalog(catalog.id); flash('Catálogo excluído.'); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir o catálogo.') }
    finally { setSaving('') }
  }

  const copyCatalogLink = async (catalog: AdminCatalog) => {
    if (!data) return
    const url = `${window.location.origin}/${data.store.slug}?catalog=${encodeURIComponent(catalog.slug)}`
    await navigator.clipboard.writeText(url)
    flash(`Link de ${catalog.name} copiado.`)
  }

  if (!data) return <div className="business-shell"><div className="business-loading"><Boxes size={30}/><strong>Carregando recursos…</strong>{error && <p>{error}</p>}</div></div>

  return <div className="business-shell">
    <header className="business-head"><button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button><div><span>Operação</span><h1>Catálogo e estoque</h1><p>Uma única base de produtos para diferentes vitrines e condições comerciais.</p></div><div className="business-summary"><strong>{catalogs.length}</strong><span>catálogo(s) ativos</span></div></header>
    {notice && <div className="business-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="business-error">{error}</div>}

    <section className="business-card"><div className="business-card__head"><div><span>Módulo 3</span><h2>Múltiplos catálogos</h2></div><button className="business-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></div>
      <div className="catalog-create"><label><span>Nome</span><input value={newCatalog.name} onChange={(e) => setNewCatalog((v) => ({ ...v, name: e.target.value }))} placeholder="Ex.: Atacado"/></label><label><span>Tipo</span><select value={newCatalog.kind} onChange={(e) => setNewCatalog((v) => ({ ...v, kind: e.target.value as typeof v.kind }))}><option value="atacado">Atacado</option><option value="varejo">Varejo</option><option value="geral">Geral</option></select></label><label><span>Pedido mínimo</span><input type="number" min="0" value={newCatalog.minimumOrder} onChange={(e) => setNewCatalog((v) => ({ ...v, minimumOrder: e.target.value }))} placeholder="herdar da loja"/></label><button disabled={saving === 'new-catalog'} onClick={createCatalog}><Plus size={16}/> Criar catálogo</button></div>
      <div className="catalog-list">{catalogs.map((catalog) => {
        const draft = catalogDrafts[catalog.id] || catalogDraft(catalog, data.products)
        return <article className="catalog-card" key={catalog.id}><div className="catalog-card__head"><div><span>{catalog.isDefault ? 'Principal' : draft.kind}</span><input value={draft.name} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, name: e.target.value } }))}/></div><div className="catalog-card__actions"><button onClick={() => copyCatalogLink(catalog)}><Copy size={15}/> Copiar link</button>{!catalog.isDefault && <button className="business-danger" onClick={() => removeCatalog(catalog)}><Trash2 size={15}/></button>}</div></div><div className="catalog-settings"><label><span>Tipo</span><select value={draft.kind} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, kind: e.target.value as CatalogDraft['kind'] } }))}><option value="geral">Geral</option><option value="atacado">Atacado</option><option value="varejo">Varejo</option></select></label><label><span>Pedido mínimo</span><input type="number" min="0" value={draft.minimumOrder} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, minimumOrder: e.target.value } }))} placeholder={`herdar R$ ${data.store.minimum_order}`}/></label>{!catalog.isDefault && <label className="business-switch"><input type="checkbox" checked={draft.active} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, active: e.target.checked } }))}/><span/>Publicado</label>}</div><div className="catalog-products"><div className="catalog-products__head"><strong>Produtos deste catálogo</strong><span>O estoque físico continua compartilhado entre todos.</span></div>{data.products.map((product) => {
          const item = draft.items[product.id] || { visible: true, priceOverride: '' }
          return <div className="catalog-product" key={product.id}><label className="catalog-visible"><input type="checkbox" checked={item.visible} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, items: { ...draft.items, [product.id]: { ...item, visible: e.target.checked } } } }))}/><span>{product.name}</span><small>{product.sku || 'SEM SKU'} · base R$ {Number(product.price).toFixed(2).replace('.', ',')}</small></label><label><span>Preço neste catálogo</span><input type="number" min="0" step="0.01" value={item.priceOverride} placeholder={String(product.price)} onChange={(e) => setCatalogDrafts((current) => ({ ...current, [catalog.id]: { ...draft, items: { ...draft.items, [product.id]: { ...item, priceOverride: e.target.value } } } }))}/></label></div>
        })}</div><div className="stock-product__actions"><span>Link: /{data.store.slug}?catalog={catalog.slug}</span><button disabled={saving === catalog.id} onClick={() => saveCatalog(catalog)}><Save size={16}/>{saving === catalog.id ? 'Salvando…' : 'Salvar catálogo'}</button></div></article>
      })}</div>
    </section>

    <section className="business-card"><div className="business-card__head"><div><span>Módulo 2</span><h2>Estoque dos produtos</h2></div><span>{controlled} com controle ativo</span></div><div className="stock-list">{data.products.map((product) => {
      const draft = drafts[product.id] || initialDraft(product)
      const combos = combinations(product.variations)
      return <article className="stock-product" key={product.id}><div className="stock-product__title"><div><small>{product.sku || 'SEM SKU'} · {product.category}</small><strong>{product.name}</strong></div><label className="business-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, enabled: event.target.checked } }))}/><span/>Controlar estoque</label></div>{combos.length === 0 ? <label className="stock-base"><span>Quantidade disponível</span><input type="number" min="0" step="1" value={draft.quantity} disabled={!draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, quantity: Math.max(0, Number(event.target.value) || 0) } }))}/></label> : <div className="stock-variants"><div className="stock-variants__note"><strong>Estoque por variação</strong><span>Saldo compartilhado entre catálogos.</span></div>{combos.map((selection) => { const key = keyOf(selection); const qty = draft.variantStock[key] ?? 0; return <label key={key}><span>{Object.entries(selection).map(([name, option]) => `${name}: ${option}`).join(' · ')}</span><input type="number" min="0" step="1" value={qty} disabled={!draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, variantStock: { ...draft.variantStock, [key]: Math.max(0, Number(event.target.value) || 0) } } }))}/></label> })}</div>}<div className="stock-product__actions"><span>{draft.enabled ? 'Baixa automática quando o pedido é criado.' : 'Sem controle: disponibilidade ilimitada.'}</span><button disabled={saving === product.id} onClick={() => saveStock(product)}><Save size={16}/>{saving === product.id ? 'Salvando…' : 'Salvar estoque'}</button></div></article>
    })}</div></section>

    <section className="business-card"><div className="business-card__head"><div><span>Retorno de estoque</span><h2>Pedidos recentes</h2></div></div><div className="business-orders">{data.orders.slice(0, 30).map((order) => <div key={order.id}><div><strong>{order.code}</strong><span>{order.items.length} item(ns) · {order.status === 'cancelled' ? 'Cancelado' : 'Enviado ao WhatsApp'}</span></div>{order.status !== 'cancelled' ? <button className="business-danger" disabled={saving === order.id} onClick={() => cancel(order.id)}><XCircle size={16}/> Cancelar e devolver</button> : <span className="business-done"><Check size={15}/> estoque devolvido</span>}</div>)}</div></section>
  </div>
}
