import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Check, CircleAlert, Copy, Download, Gift, MessageCircle, Percent, RefreshCcw, Save, ShoppingCart, Star, Trash2, TrendingUp } from 'lucide-react'
import './phase3-panel.css'

type Plan = { code: string; name: string; features: Record<string, boolean> }
type Seller = { id: string; name: string; slug: string; commissionRate: number; is_active: boolean }
type Order = { id: string; code: string; total: number; status: string; seller_id?: string | null; sale_confirmed_at?: string | null; commissionAmount: number; coupon_code?: string; discount: number; created_at: string }
type Phase3Data = { plan: Plan; summary: { activeCoupons: number; activeCarts: number; referrals: number; creditMonths: number }; sellers: Seller[]; orders: Order[] }
type Coupon = { id: string; code: string; type: 'percent' | 'fixed'; value: number; minimumSubtotal: number; maxUses: number | null; usedCount: number; active: boolean; startsAt?: string | null; expiresAt?: string | null }
type Recovery = { id: string; items: Array<{ name?: string; quantity?: number }>; subtotal: number; state: string; updatedAt: string; ageMinutes: number; abandoned: boolean; customer?: { name?: string; email?: string; phone?: string } | null; sellerName?: string | null; catalogName?: string | null; whatsappUrl?: string | null }
type Referral = { code: string; referrals: number; creditedMonths: number; availableCreditMonths: number; rule: string; billingNote: string }
type Catalog = { id: string; slug: string; name: string; kind: string }
type ReviewSummary = { enabled: boolean; average: number; count: number }
type Bootstrap = { store: { slug: string; name: string } }
type CommissionReport = { periodDays: number; sellers: Array<{ sellerId: string; name: string; configuredRate: number; confirmedSales: number; confirmedTotal: number; commissionTotal: number }>; interpretation: string }

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
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

export default function Phase3Panel() {
  const [data, setData] = useState<Phase3Data | null>(null)
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [recoveries, setRecoveries] = useState<Recovery[]>([])
  const [referral, setReferral] = useState<Referral | null>(null)
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [reviews, setReviews] = useState<ReviewSummary | null>(null)
  const [commissions, setCommissions] = useState<CommissionReport | null>(null)
  const [storeSlug, setStoreSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newCoupon, setNewCoupon] = useState({ code: '', type: 'percent' as 'percent' | 'fixed', value: '10', maxUses: '' })
  const [rates, setRates] = useState<Record<string, string>>({})

  const load = async () => {
    setError('')
    try {
      const [phase3, couponData, recoveryData, referralData, catalogData, bootstrap] = await Promise.all([
        request<Phase3Data>('/api/admin/phase3'),
        request<{ coupons: Coupon[] }>('/api/admin/phase3/coupons'),
        request<{ recoveries: Recovery[] }>('/api/admin/phase3/cart-recovery'),
        request<Referral>('/api/admin/phase3/referral'),
        request<{ catalogs: Catalog[] }>('/api/admin/catalogs'),
        request<Bootstrap>('/api/admin/bootstrap'),
      ])
      setData(phase3)
      setCoupons(couponData.coupons)
      setRecoveries(recoveryData.recoveries)
      setReferral(referralData)
      setCatalogs(catalogData.catalogs)
      setStoreSlug(bootstrap.store.slug)
      setRates(Object.fromEntries(phase3.sellers.map((seller) => [seller.id, String(seller.commissionRate || 0)])))
      if (bootstrap.store.slug) {
        const summary = await request<ReviewSummary>(`/api/public/reviews/${encodeURIComponent(bootstrap.store.slug)}`).catch(() => null)
        setReviews(summary)
      }
      if (phase3.plan.features.sellerCommission) {
        setCommissions(await request<CommissionReport>('/api/admin/phase3/commissions?days=30'))
      } else setCommissions(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar a Fase 3.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const intelligence = data?.plan.features.commercialIntelligence === true
  const commissionEnabled = data?.plan.features.sellerCommission === true
  const reviewsEnabled = data?.plan.features.reviews === true
  const abandoned = useMemo(() => recoveries.filter((item) => item.abandoned), [recoveries])

  const createCoupon = async () => {
    setBusy('coupon'); setError('')
    try {
      await request('/api/admin/phase3/coupons', {
        method: 'POST',
        body: JSON.stringify({ code: newCoupon.code, type: newCoupon.type, value: Number(newCoupon.value), maxUses: newCoupon.maxUses ? Number(newCoupon.maxUses) : null }),
      })
      setNewCoupon({ code: '', type: 'percent', value: '10', maxUses: '' })
      flash('Cupom criado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o cupom.') }
    finally { setBusy('') }
  }

  const toggleCoupon = async (coupon: Coupon) => {
    setBusy(coupon.id)
    try {
      await request(`/api/admin/phase3/coupons/${encodeURIComponent(coupon.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !coupon.active }) })
      flash(coupon.active ? 'Cupom pausado.' : 'Cupom reativado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar o cupom.') }
    finally { setBusy('') }
  }

  const deleteCoupon = async (coupon: Coupon) => {
    if (!window.confirm(`Excluir o cupom ${coupon.code}?`)) return
    setBusy(coupon.id)
    try {
      await request(`/api/admin/phase3/coupons/${encodeURIComponent(coupon.id)}`, { method: 'DELETE' })
      flash('Cupom excluído.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir o cupom.') }
    finally { setBusy('') }
  }

  const dismissRecovery = async (item: Recovery) => {
    setBusy(item.id)
    try {
      await request(`/api/admin/phase3/cart-recovery/${encodeURIComponent(item.id)}/dismiss`, { method: 'POST' })
      flash('Carrinho removido da fila de recuperação.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível remover o carrinho.') }
    finally { setBusy('') }
  }

  const saveRate = async (seller: Seller) => {
    setBusy(`rate-${seller.id}`)
    try {
      await request(`/api/admin/phase3/sellers/${encodeURIComponent(seller.id)}/commission`, { method: 'PATCH', body: JSON.stringify({ rate: Number(rates[seller.id] || 0) }) })
      flash(`Comissão de ${seller.name} atualizada.`)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a comissão.') }
    finally { setBusy('') }
  }

  const confirmSale = async (order: Order, undo = false) => {
    setBusy(order.id)
    try {
      await request(`/api/admin/phase3/orders/${encodeURIComponent(order.id)}/${undo ? 'unconfirm-sale' : 'confirm-sale'}`, { method: 'POST' })
      flash(undo ? `Venda ${order.code} desconfirmada.` : `Venda ${order.code} confirmada.`)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível atualizar a venda.') }
    finally { setBusy('') }
  }

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    flash('Copiado.')
  }

  if (loading || !data) return <div className="phase3-shell"><div className="phase3-loading"><RefreshCcw size={24}/><strong>{loading ? 'Carregando crescimento…' : 'Não foi possível abrir esta área.'}</strong>{error && <p>{error}</p>}</div></div>

  const referralUrl = referral ? `${window.location.origin}/criar-conta?ref=${encodeURIComponent(referral.code)}` : ''

  return <div className="phase3-shell">
    <header className="phase3-title"><div><span>Fase 3 · {data.plan.name}</span><h1>Crescimento e confiança</h1><p>Conversão, recompra e gestão comercial sem confundir intenção de pedido com faturamento confirmado.</p></div><button className="phase3-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></header>
    {notice && <div className="phase3-notice"><Check size={16}/>{notice}</div>}
    {error && <div className="phase3-error"><CircleAlert size={17}/>{error}</div>}

    <section className="phase3-metrics">
      <article><Percent size={20}/><span>Cupons ativos</span><strong>{data.summary.activeCoupons}</strong></article>
      <article><ShoppingCart size={20}/><span>Carrinhos em aberto</span><strong>{data.summary.activeCarts}</strong></article>
      <article><Gift size={20}/><span>Indicações</span><strong>{referral?.referrals || 0}</strong></article>
      <article><Star size={20}/><span>Avaliações</span><strong>{reviews?.enabled ? reviews.count : '—'}</strong></article>
    </section>

    <section className={`phase3-card ${!intelligence ? 'is-locked' : ''}`}>
      <div className="phase3-card-head"><div><span>Funil comercial</span><h2>Inteligência comercial</h2><p>Cliques, carrinhos, checkout e WhatsApp continuam sendo sinais de intenção; não são faturamento.</p></div><BarChart3 size={25}/></div>
      <button className="phase3-primary" disabled={!intelligence} onClick={() => go('/painel/relatorios')}>{intelligence ? 'Abrir inteligência' : 'Disponível a partir do Plano 2'}</button>
    </section>

    <section className="phase3-grid">
      <article className="phase3-card">
        <div className="phase3-card-head"><div><span>Conversão</span><h2>Cupons</h2><p>Percentual ou valor fixo, com limite de usos.</p></div><Percent size={23}/></div>
        <div className="phase3-form-row"><input value={newCoupon.code} onChange={(event) => setNewCoupon((value) => ({ ...value, code: event.target.value.toUpperCase() }))} placeholder="CÓDIGO"/><select value={newCoupon.type} onChange={(event) => setNewCoupon((value) => ({ ...value, type: event.target.value as 'percent' | 'fixed' }))}><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></select><input type="number" min="0" step="0.01" value={newCoupon.value} onChange={(event) => setNewCoupon((value) => ({ ...value, value: event.target.value }))} placeholder="Valor"/><input type="number" min="1" value={newCoupon.maxUses} onChange={(event) => setNewCoupon((value) => ({ ...value, maxUses: event.target.value }))} placeholder="Limite opcional"/><button className="phase3-primary" disabled={busy === 'coupon'} onClick={createCoupon}>Criar</button></div>
        <div className="phase3-list">{coupons.map((coupon) => <div key={coupon.id}><div><strong>{coupon.code}</strong><span>{coupon.type === 'percent' ? `${coupon.value}%` : brl.format(coupon.value)} · {coupon.usedCount}{coupon.maxUses == null ? '' : `/${coupon.maxUses}`} uso(s)</span></div><div className="phase3-actions"><button disabled={busy === coupon.id} onClick={() => toggleCoupon(coupon)}>{coupon.active ? 'Pausar' : 'Ativar'}</button><button className="danger" disabled={busy === coupon.id} onClick={() => deleteCoupon(coupon)}><Trash2 size={15}/></button></div></div>)}{!coupons.length && <p>Nenhum cupom criado ainda.</p>}</div>
      </article>

      <article className="phase3-card">
        <div className="phase3-card-head"><div><span>Recuperação</span><h2>Carrinhos</h2><p>{abandoned.length} carrinho(s) já passaram de 15 minutos.</p></div><ShoppingCart size={23}/></div>
        <div className="phase3-list phase3-recoveries">{recoveries.slice(0, 20).map((item) => <div key={item.id}><div><strong>{item.customer?.name || 'Visitante não identificado'}</strong><span>{brl.format(item.subtotal)} · {item.items.reduce((sum, product) => sum + Number(product.quantity || 0), 0)} item(ns) · {item.ageMinutes} min</span></div><div className="phase3-actions">{item.whatsappUrl && <a href={item.whatsappUrl} target="_blank" rel="noreferrer"><MessageCircle size={15}/> Chamar</a>}<button disabled={busy === item.id} onClick={() => dismissRecovery(item)}>Ignorar</button></div></div>)}{!recoveries.length && <p>Nenhum carrinho em aberto.</p>}</div>
      </article>
    </section>

    <section className="phase3-grid">
      <article className="phase3-card">
        <div className="phase3-card-head"><div><span>1 por 1</span><h2>Indique e ganhe</h2><p>{referral?.rule}</p></div><Gift size={23}/></div>
        {referral && <><div className="phase3-referral-code"><code>{referral.code}</code><button onClick={() => copy(referralUrl)}><Copy size={16}/> Copiar link</button></div><div className="phase3-credit"><strong>{referral.availableCreditMonths}</strong><span>mês(es) de crédito acumulado(s)</span></div><p className="phase3-muted">{referral.billingNote}</p></>}
      </article>

      <article className="phase3-card">
        <div className="phase3-card-head"><div><span>Compartilhamento</span><h2>Catálogo PDF ShopVax</h2><p>Geração pelo catálogo atual, com preços e rodapé ShopVax.</p></div><Download size={23}/></div>
        <div className="phase3-list">{catalogs.map((catalog) => <div key={catalog.id}><div><strong>{catalog.name}</strong><span>{catalog.kind}</span></div><a className="phase3-download" href={`/api/admin/phase3/catalogs/${encodeURIComponent(catalog.id)}/pdf`}><Download size={15}/> PDF</a></div>)}{!catalogs.length && <p>Nenhum catálogo disponível.</p>}</div>
      </article>
    </section>

    <section className={`phase3-card ${!reviewsEnabled ? 'is-locked' : ''}`}>
      <div className="phase3-card-head"><div><span>Prova social</span><h2>Avaliações verificadas</h2><p>Somente clientes autenticados que já fizeram um pedido podem publicar uma avaliação.</p></div><Star size={24}/></div>
      {reviewsEnabled && reviews ? <div className="phase3-review-summary"><strong>{reviews.average.toFixed(1)}</strong><div><span>{reviews.count} avaliação{reviews.count === 1 ? '' : 'ões'}</span>{storeSlug && <a href={`/${storeSlug}`} target="_blank" rel="noreferrer">Ver na loja</a>}</div></div> : <p className="phase3-muted">Disponível nos Planos 2 e 3.</p>}
    </section>

    <section className={`phase3-card ${!commissionEnabled ? 'is-locked' : ''}`}>
      <div className="phase3-card-head"><div><span>Plano 3</span><h2>Comissão de vendedoras</h2><p>Comissão só é gerada depois que você confirma explicitamente que o pedido virou venda.</p></div><TrendingUp size={24}/></div>
      {!commissionEnabled ? <p className="phase3-muted">Recurso exclusivo do Plano 3.</p> : <>
        <div className="phase3-seller-rates">{data.sellers.map((seller) => <div key={seller.id}><strong>{seller.name}</strong><label><input type="number" min="0" max="100" step="0.01" value={rates[seller.id] ?? '0'} onChange={(event) => setRates((value) => ({ ...value, [seller.id]: event.target.value }))}/><span>%</span></label><button disabled={busy === `rate-${seller.id}`} onClick={() => saveRate(seller)}><Save size={15}/> Salvar</button></div>)}</div>
        {commissions && <div className="phase3-commission-summary">{commissions.sellers.map((seller) => <article key={seller.sellerId}><span>{seller.name}</span><strong>{brl.format(seller.commissionTotal)}</strong><small>{seller.confirmedSales} venda(s) confirmada(s) · {brl.format(seller.confirmedTotal)}</small></article>)}</div>}
        <div className="phase3-orders"><div className="phase3-orders-head"><span>Pedido</span><span>Quando</span><span>Valor</span><span>Status</span><span>Ação</span></div>{data.orders.slice(0, 40).map((order) => <div key={order.id}><strong>{order.code}</strong><span>{date.format(new Date(order.created_at))}</span><b>{brl.format(order.total)}</b><span>{order.status === 'confirmado' ? `Venda confirmada · comissão ${brl.format(order.commissionAmount)}` : order.status === 'cancelled' ? 'Cancelado' : 'Ainda não confirmado como venda'}</span><div>{order.status === 'confirmado' ? <button disabled={busy === order.id} onClick={() => confirmSale(order, true)}>Desfazer</button> : order.status === 'cancelled' ? null : <button className="confirm" disabled={busy === order.id} onClick={() => confirmSale(order)}>Confirmar venda</button>}</div></div>)}</div>
      </>}
    </section>
  </div>
}
