import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CreditCard, ExternalLink, MapPin, PackageCheck, RefreshCcw, Truck } from 'lucide-react'
import './phase4-public.css'

type PublicConfig = {
  eligible: boolean
  payment: { enabled: boolean; methods: string[] }
  shipping: { enabled: boolean }
  customerAccountPath?: string
}

type CartItem = { product?: { id?: string; name?: string; price?: number }; quantity?: number; selections?: Record<string, string> }
type Quote = { id: string; name: string; amount: number; deliveryDaysMin: number; deliveryDaysMax: number }

type OrderResponse = { orderId?: string; code?: string; total?: number; whatsappUrl?: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function routeContext() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const blocked = ['painel','admin','cliente','entrar','criar-conta','perfil','feed','descobrir','para-lojas']
  if (!parts[0] || blocked.includes(parts[0])) return { storeSlug: '', sellerSlug: '', catalogSlug: '' }
  return { storeSlug: parts[0], sellerSlug: parts[1] || '', catalogSlug: new URLSearchParams(window.location.search).get('catalog') || '' }
}

function cartFor(storeSlug: string): CartItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(`shopvax-cart-v1:${encodeURIComponent(storeSlug)}`) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function subtotalOf(items: CartItem[]) {
  return Math.round(items.reduce((sum, item) => sum + Number(item.product?.price || 0) * Math.max(1, Number(item.quantity || 1)), 0) * 100) / 100
}

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || 'Não foi possível concluir a operação.') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return payload as T
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function Phase4PublicRuntime() {
  const route = useMemo(routeContext, [])
  const [target, setTarget] = useState<Element | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [customerLogged, setCustomerLogged] = useState(false)
  const [postalCode, setPostalCode] = useState('')
  const [state, setState] = useState('BA')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null)
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [billingType, setBillingType] = useState('PIX')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [lastPayment, setLastPayment] = useState<{ invoiceUrl: string; value: number; code?: string } | null>(null)
  const [cart, setCart] = useState<CartItem[]>(() => cartFor(route.storeSlug))
  const subtotal = subtotalOf(cart)

  useEffect(() => {
    if (!route.storeSlug) return
    let mounted = true
    request<PublicConfig>(`/api/public/phase4/config/${encodeURIComponent(route.storeSlug)}`)
      .then((next) => {
        if (!mounted) return
        setConfig(next)
        if (next.payment.methods.length && !next.payment.methods.includes(billingType)) setBillingType(next.payment.methods[0])
        if (next.payment.enabled) {
          request(`/api/public/store/${encodeURIComponent(route.storeSlug)}/customers/me`)
            .then(() => { if (mounted) setCustomerLogged(true) })
            .catch(() => { if (mounted) setCustomerLogged(false) })
        }
      })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [route.storeSlug])

  useEffect(() => {
    if (!route.storeSlug) return
    const sync = () => {
      setTarget(document.querySelector('.cart-drawer__foot'))
      setCart(cartFor(route.storeSlug))
    }
    sync()
    const timer = window.setInterval(sync, 900)
    return () => window.clearInterval(timer)
  }, [route.storeSlug])

  const calculateShipping = async () => {
    setBusy('shipping'); setMessage(''); setSelectedQuote(null)
    try {
      const payload = await request<{ quotes: Quote[] }>('/api/public/phase4/shipping/quote', {
        method: 'POST', body: JSON.stringify({ storeSlug: route.storeSlug, postalCode, state, subtotal }),
      })
      setQuotes(payload.quotes)
      if (!payload.quotes.length) setMessage('Nenhuma regra de entrega atende este CEP e valor de pedido.')
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Não foi possível calcular o frete.') }
    finally { setBusy('') }
  }

  const onlineCheckout = async () => {
    if (!cart.length) return
    if (!customerLogged) {
      go(config?.customerAccountPath || `/cliente/${encodeURIComponent(route.storeSlug)}`)
      return
    }
    setBusy('payment'); setMessage(''); setLastPayment(null)
    try {
      const items = cart.map((item) => ({
        productId: item.product?.id || '',
        quantity: Math.max(1, Number(item.quantity || 1)),
        selections: item.selections || {},
      })).filter((item) => item.productId)
      const order = await request<OrderResponse>('/api/business/orders', {
        method: 'POST',
        body: JSON.stringify({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug || undefined, catalogSlug: route.catalogSlug || undefined, items }),
      })
      if (!order.orderId) throw new Error('O pedido foi criado sem identificador para pagamento.')

      if (selectedQuote) {
        await request(`/api/public/phase4/orders/${encodeURIComponent(order.orderId)}/shipping`, {
          method: 'POST', body: JSON.stringify({ storeSlug: route.storeSlug, quoteId: selectedQuote.id }),
        })
      }

      const payment = await request<{ payment: { invoiceUrl: string; value: number }; order: { code?: string } }>('/api/public/phase4/payments', {
        method: 'POST', body: JSON.stringify({ storeSlug: route.storeSlug, orderId: order.orderId, billingType, cpfCnpj }),
      })
      setLastPayment({ invoiceUrl: payment.payment.invoiceUrl, value: payment.payment.value, code: payment.order.code || order.code })
      window.open(payment.payment.invoiceUrl, '_blank', 'noopener,noreferrer')
      setMessage('Cobrança criada. O pagamento abriu em uma página segura do Asaas.')
    } catch (err) {
      const status = (err as Error & { status?: number }).status
      if (status === 401) setCustomerLogged(false)
      setMessage(err instanceof Error ? err.message : 'Não foi possível iniciar o pagamento.')
    } finally { setBusy('') }
  }

  if (!target || !config?.eligible || (!config.payment.enabled && !config.shipping.enabled)) return null

  return createPortal(<section className="phase4-public-addon">
    {config.shipping.enabled && <div className="phase4-public-block">
      <div className="phase4-public-head"><Truck size={17}/><div><strong>Calcular entrega</strong><span>Veja valor e prazo antes de finalizar.</span></div></div>
      <div className="phase4-shipping-entry"><input inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="CEP"/><input className="phase4-uf" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="UF"/><button disabled={busy === 'shipping'} onClick={calculateShipping}>{busy === 'shipping' ? <RefreshCcw size={15}/> : <MapPin size={15}/>} Calcular</button></div>
      {quotes.length > 0 && <div className="phase4-quote-list">{quotes.map((quote) => <button key={quote.id} className={selectedQuote?.id === quote.id ? 'is-active' : ''} onClick={() => setSelectedQuote(quote)}><span>{selectedQuote?.id === quote.id ? <Check size={15}/> : <PackageCheck size={15}/>}<b>{quote.name}</b></span><small>{quote.deliveryDaysMin}–{quote.deliveryDaysMax} dias</small><strong>{quote.amount === 0 ? 'Grátis' : money.format(quote.amount)}</strong></button>)}</div>}
    </div>}

    {config.payment.enabled && <div className="phase4-public-block phase4-pay-block">
      <div className="phase4-public-head"><CreditCard size={17}/><div><strong>Pagamento online</strong><span>Checkout seguro hospedado pelo Asaas.</span></div></div>
      {!customerLogged ? <button className="phase4-customer-login" onClick={() => go(config.customerAccountPath || `/cliente/${encodeURIComponent(route.storeSlug)}`)}>Entrar na conta para pagar online</button> : <>
        <div className="phase4-payment-fields"><input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} inputMode="numeric" placeholder="CPF ou CNPJ"/><select value={billingType} onChange={(e) => setBillingType(e.target.value)}>{config.payment.methods.map((method) => <option key={method} value={method}>{method === 'CREDIT_CARD' ? 'Cartão' : method === 'BOLETO' ? 'Boleto' : method === 'PIX' ? 'Pix' : method}</option>)}</select></div>
        <button className="phase4-online-pay" disabled={!cart.length || busy === 'payment'} onClick={onlineCheckout}>{busy === 'payment' ? 'Criando cobrança…' : `Finalizar online · ${money.format(subtotal + Number(selectedQuote?.amount || 0))}`} <ExternalLink size={16}/></button>
      </>}
      {lastPayment && <a className="phase4-reopen-payment" href={lastPayment.invoiceUrl} target="_blank" rel="noreferrer">Reabrir cobrança de {money.format(lastPayment.value)} <ExternalLink size={13}/></a>}
    </div>}
    {message && <p className="phase4-public-message">{message}</p>}
  </section>, target)
}
