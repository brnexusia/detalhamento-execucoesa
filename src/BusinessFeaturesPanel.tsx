import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Boxes, Check, RefreshCcw, Save, XCircle } from 'lucide-react'
import { api } from './api'
import type { AdminBootstrap, AdminProduct, VariationGroup } from './types'
import './business-features.css'

type StockDraft = { enabled: boolean; quantity: number; variantStock: Record<string, number> }

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
  for (const group of valid) {
    rows = rows.flatMap((row) => group.options.map((option) => ({ ...row, [group.name]: option }))).slice(0, 300)
  }
  return rows
}

function initialDraft(product: AdminProduct): StockDraft {
  return {
    enabled: Boolean(product.stock_enabled),
    quantity: Math.max(0, Number(product.stock_quantity || 0)),
    variantStock: { ...(product.variant_stock || {}) },
  }
}

export default function BusinessFeaturesPanel() {
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [drafts, setDrafts] = useState<Record<string, StockDraft>>({})
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const next = await api.bootstrap()
      setData(next)
      setDrafts(Object.fromEntries(next.products.map((product) => [product.id, initialDraft(product)])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o estoque.')
    }
  }

  useEffect(() => { void load() }, [])
  const controlled = useMemo(() => data?.products.filter((product) => drafts[product.id]?.enabled).length || 0, [data, drafts])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const save = async (product: AdminProduct) => {
    const draft = drafts[product.id]
    if (!draft) return
    setSaving(product.id); setError('')
    try {
      await api.updateStock(product.id, draft)
      flash(`Estoque de ${product.name} atualizado.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o estoque.')
    } finally { setSaving('') }
  }

  const cancel = async (orderId: string) => {
    if (!window.confirm('Cancelar este pedido e devolver o estoque correspondente?')) return
    setSaving(orderId); setError('')
    try {
      const result = await api.cancelOrder(orderId)
      flash(result.idempotent ? 'Esse pedido já estava cancelado.' : 'Pedido cancelado e estoque devolvido.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cancelar o pedido.')
    } finally { setSaving('') }
  }

  if (!data) return <div className="business-shell"><div className="business-loading"><Boxes size={30}/><strong>Carregando recursos…</strong>{error && <p>{error}</p>}</div></div>

  return <div className="business-shell">
    <header className="business-head"><button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button><div><span>Operação</span><h1>Estoque</h1><p>Controle simples por produto ou por combinação de variações.</p></div><div className="business-summary"><strong>{controlled}</strong><span>produtos controlados</span></div></header>
    {notice && <div className="business-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="business-error">{error}</div>}

    <section className="business-card"><div className="business-card__head"><div><span>Módulo 2</span><h2>Estoque dos produtos</h2></div><button className="business-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></div>
      <div className="stock-list">{data.products.map((product) => {
        const draft = drafts[product.id] || initialDraft(product)
        const combos = combinations(product.variations)
        return <article className="stock-product" key={product.id}>
          <div className="stock-product__title"><div><small>{product.sku || 'SEM SKU'} · {product.category}</small><strong>{product.name}</strong></div><label className="business-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, enabled: event.target.checked } }))}/><span/>Controlar estoque</label></div>
          {combos.length === 0 ? <label className="stock-base"><span>Quantidade disponível</span><input type="number" min="0" step="1" value={draft.quantity} disabled={!draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, quantity: Math.max(0, Number(event.target.value) || 0) } }))}/></label> : <div className="stock-variants"><div className="stock-variants__note"><strong>Estoque por variação</strong><span>As combinações abaixo compartilham o mesmo cadastro do produto.</span></div>{combos.map((selection) => {
            const key = keyOf(selection)
            const qty = draft.variantStock[key] ?? 0
            return <label key={key}><span>{Object.entries(selection).map(([name, option]) => `${name}: ${option}`).join(' · ')}</span><input type="number" min="0" step="1" value={qty} disabled={!draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, variantStock: { ...draft.variantStock, [key]: Math.max(0, Number(event.target.value) || 0) } } }))}/></label>
          })}</div>}
          <div className="stock-product__actions"><span>{draft.enabled ? 'Baixa automática quando o pedido é criado.' : 'Sem controle: disponibilidade ilimitada.'}</span><button disabled={saving === product.id} onClick={() => save(product)}><Save size={16}/>{saving === product.id ? 'Salvando…' : 'Salvar estoque'}</button></div>
        </article>
      })}{!data.products.length && <p className="business-empty">Cadastre produtos para começar a controlar estoque.</p>}</div>
    </section>

    <section className="business-card"><div className="business-card__head"><div><span>Retorno de estoque</span><h2>Pedidos recentes</h2></div></div><div className="business-orders">{data.orders.slice(0, 30).map((order) => <div key={order.id}><div><strong>{order.code}</strong><span>{order.items.length} item(ns) · {order.status === 'cancelled' ? 'Cancelado' : 'Enviado ao WhatsApp'}</span></div>{order.status !== 'cancelled' ? <button className="business-danger" disabled={saving === order.id} onClick={() => cancel(order.id)}><XCircle size={16}/> Cancelar e devolver</button> : <span className="business-done"><Check size={15}/> estoque devolvido</span>}</div>)}{!data.orders.length && <p className="business-empty">Ainda não há pedidos.</p>}</div></section>
  </div>
}
