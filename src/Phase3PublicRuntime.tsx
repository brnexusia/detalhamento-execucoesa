import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Star, Tag, X } from 'lucide-react'
import './phase3-public.css'

type CartItem = {
  product?: { id?: string; name?: string; price?: number }
  quantity?: number
  selections?: Record<string, string>
}

type ReviewSummary = {
  enabled: boolean
  average: number
  count: number
  reviews: Array<{ rating: number; comment: string; reviewer: string; updatedAt: string }>
}

function publicContext() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const customer = parts[0] === 'cliente'
  if (customer) return { customer: true, storeSlug: parts[1] || '', sellerSlug: '', catalogSlug: '' }
  const blocked = ['painel', 'admin', 'entrar', 'criar-conta', 'perfil', 'feed', 'descobrir', 'para-lojas']
  if (!parts[0] || blocked.includes(parts[0])) return { customer: false, storeSlug: '', sellerSlug: '', catalogSlug: '' }
  return {
    customer: false,
    storeSlug: parts[0],
    sellerSlug: parts[1] || '',
    catalogSlug: new URLSearchParams(window.location.search).get('catalog') || '',
  }
}

function readCart(storeSlug: string): CartItem[] {
  if (!storeSlug) return []
  try {
    const value = JSON.parse(localStorage.getItem(`shopvax-cart-v1:${encodeURIComponent(storeSlug)}`) || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function cartSubtotal(items: CartItem[]) {
  return Math.round(items.reduce((sum, item) => sum + Number(item.product?.price || 0) * Math.max(1, Number(item.quantity || 1)), 0) * 100) / 100
}

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { credentials: 'include', ...options, headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload
}

export default function Phase3PublicRuntime() {
  const context = useMemo(publicContext, [])
  const [cart, setCart] = useState<CartItem[]>(() => readCart(context.storeSlug))
  const [reviews, setReviews] = useState<ReviewSummary | null>(null)
  const [couponOpen, setCouponOpen] = useState(false)
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState(() => context.storeSlug ? localStorage.getItem(`shopvax-coupon:${context.storeSlug}`) || '' : '')
  const [couponInfo, setCouponInfo] = useState<{ discount: number; total: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [myReviewLoaded, setMyReviewLoaded] = useState(false)
  const lastSnapshot = useRef('')
  const subtotal = cartSubtotal(cart)

  useEffect(() => {
    if (!context.storeSlug) return
    jsonRequest(`/api/public/reviews/${encodeURIComponent(context.storeSlug)}`)
      .then((value) => setReviews(value as ReviewSummary))
      .catch(() => undefined)
  }, [context.storeSlug])

  // A fachada da Fase 3 usa o core de pedido já validado e só então aplica benefícios/recuperação.
  useEffect(() => {
    if (!context.storeSlug || context.customer) return
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let nextInput: RequestInfo | URL = input
      try {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const pathname = new URL(rawUrl, window.location.origin).pathname
        if (pathname === '/api/business/orders' && String(init?.method || 'GET').toUpperCase() === 'POST' && typeof init?.body === 'string') {
          const body = JSON.parse(init.body)
          if (body?.storeSlug === context.storeSlug) {
            const activeCoupon = localStorage.getItem(`shopvax-coupon:${context.storeSlug}`) || ''
            init = { ...init, body: JSON.stringify(activeCoupon ? { ...body, couponCode: activeCoupon } : body) }
            nextInput = '/api/business/orders/phase3'
          }
        }
      } catch {}
      return originalFetch(nextInput, init)
    }
    return () => { window.fetch = originalFetch }
  }, [context.storeSlug, context.customer])

  // O carrinho legado já persiste em localStorage. A Fase 3 observa essa mesma fonte e cria o snapshot recuperável.
  useEffect(() => {
    if (!context.storeSlug || context.customer) return
    const sync = () => setCart(readCart(context.storeSlug))
    const timer = window.setInterval(sync, 1200)
    sync()
    return () => window.clearInterval(timer)
  }, [context.storeSlug, context.customer])

  useEffect(() => {
    if (!context.storeSlug || context.customer) return
    const compact = cart.map((item) => ({
      productId: item.product?.id || '',
      name: item.product?.name || '',
      quantity: Math.max(1, Number(item.quantity || 1)),
      selections: item.selections || {},
    })).filter((item) => item.productId)
    const signature = JSON.stringify(compact)
    if (signature === lastSnapshot.current) return
    const timer = window.setTimeout(() => {
      lastSnapshot.current = signature
      void jsonRequest('/api/public/cart-recovery', {
        method: 'POST',
        body: JSON.stringify({
          storeSlug: context.storeSlug,
          sellerSlug: context.sellerSlug || undefined,
          catalogSlug: context.catalogSlug || undefined,
          subtotal,
          items: compact,
        }),
      }).catch(() => undefined)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [cart, subtotal, context.storeSlug, context.sellerSlug, context.catalogSlug, context.customer])

  useEffect(() => {
    if (!context.customer || !context.storeSlug || myReviewLoaded) return
    setMyReviewLoaded(true)
    jsonRequest(`/api/public/store/${encodeURIComponent(context.storeSlug)}/customers/review`)
      .then((payload) => {
        if (payload?.review) {
          setReviewRating(Number(payload.review.rating || 5))
          setReviewComment(String(payload.review.comment || ''))
        }
      })
      .catch(() => undefined)
  }, [context.customer, context.storeSlug, myReviewLoaded])

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase()
    if (!code) return
    setNotice('')
    try {
      const payload = await jsonRequest('/api/public/coupons/validate', {
        method: 'POST', body: JSON.stringify({ storeSlug: context.storeSlug, code, subtotal }),
      })
      localStorage.setItem(`shopvax-coupon:${context.storeSlug}`, code)
      setCoupon(code)
      setCouponInfo({ discount: Number(payload.discount || 0), total: Number(payload.total || 0) })
      setCouponOpen(false)
      setNotice(`Cupom ${code} aplicado.`)
      window.setTimeout(() => setNotice(''), 2600)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Cupom inválido.') }
  }

  const removeCoupon = () => {
    localStorage.removeItem(`shopvax-coupon:${context.storeSlug}`)
    setCoupon('')
    setCouponInfo(null)
    setCouponInput('')
  }

  const saveReview = async () => {
    setNotice('')
    try {
      await jsonRequest(`/api/public/store/${encodeURIComponent(context.storeSlug)}/customers/review`, {
        method: 'PUT', body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      })
      setNotice('Avaliação salva. Obrigado!')
      const latest = await jsonRequest(`/api/public/reviews/${encodeURIComponent(context.storeSlug)}`)
      setReviews(latest as ReviewSummary)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível salvar a avaliação.') }
  }

  if (!context.storeSlug) return null

  if (context.customer) {
    if (reviews?.enabled === false) return null
    return <section className="phase3-customer-review">
      <div><span>Avaliação verificada</span><h2>Como foi sua experiência?</h2><p>Sua avaliação só é publicada se esta conta já tiver feito um pedido na loja.</p></div>
      <div className="phase3-stars" aria-label="Nota da loja">{[1,2,3,4,5].map((value) => <button key={value} className={value <= reviewRating ? 'is-active' : ''} onClick={() => setReviewRating(value)}><Star size={22}/></button>)}</div>
      <textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Conte como foi o atendimento e a compra" maxLength={1000}/>
      <button className="phase3-review-save" onClick={saveReview}><Check size={17}/> Salvar avaliação</button>
      {notice && <p className="phase3-runtime-notice">{notice}</p>}
    </section>
  }

  return <>
    <div className="phase3-public-tools">
      {reviews?.enabled && reviews.count > 0 && <button className="phase3-rating-chip" onClick={() => document.getElementById('phase3-reviews')?.scrollIntoView({ behavior: 'smooth' })}><Star size={16} fill="currentColor"/><strong>{reviews.average.toFixed(1)}</strong><span>{reviews.count} avaliação{reviews.count === 1 ? '' : 'ões'}</span></button>}
      <button className={`phase3-coupon-chip ${coupon ? 'is-active' : ''}`} onClick={() => setCouponOpen(true)}><Tag size={16}/>{coupon ? <><strong>{coupon}</strong><span>aplicado</span></> : <span>Tem cupom?</span>}</button>
      {coupon && <button className="phase3-coupon-remove" onClick={removeCoupon} aria-label="Remover cupom"><X size={14}/></button>}
    </div>

    {couponOpen && <div className="phase3-coupon-popover"><div><strong>Aplicar cupom</strong><button onClick={() => setCouponOpen(false)}><X size={18}/></button></div><p>O desconto é validado antes de abrir o WhatsApp.</p><div className="phase3-coupon-entry"><input value={couponInput} onChange={(event) => setCouponInput(event.target.value.toUpperCase())} placeholder="SEUCUPOM"/><button onClick={applyCoupon}>Aplicar</button></div>{subtotal > 0 && <small>Subtotal atual: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(subtotal)}</small>}</div>}
    {notice && !context.customer && <div className="phase3-toast">{notice}</div>}
    {coupon && couponInfo && <div className="phase3-discount-hint"><Tag size={14}/> Economia estimada: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(couponInfo.discount)}</div>}

    {reviews?.enabled && reviews.count > 0 && <section className="phase3-public-reviews" id="phase3-reviews"><div className="phase3-reviews-head"><div><span>Clientes da loja</span><h2>Avaliações verificadas</h2></div><div><Star size={20} fill="currentColor"/><strong>{reviews.average.toFixed(1)}</strong><span>{reviews.count} avaliação{reviews.count === 1 ? '' : 'ões'}</span></div></div><div className="phase3-review-cards">{reviews.reviews.slice(0, 6).map((review, index) => <article key={`${review.reviewer}-${index}`}><div className="phase3-review-stars">{Array.from({ length: 5 }, (_, star) => <Star key={star} size={14} fill={star < review.rating ? 'currentColor' : 'none'}/>)}</div>{review.comment && <p>“{review.comment}”</p>}<span>{review.reviewer}</span></article>)}</div></section>}
  </>
}
