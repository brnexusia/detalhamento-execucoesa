import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Grid2X2, Heart, Minus, Plus, Search, ShoppingBag, Sparkles, X } from 'lucide-react'
import { api } from './api'
import { demoPayload } from './data'
import type { CartItem, Product, PublicPayload } from './types'

type ViewMode = 'store' | 'feed'
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function routeParts() {
  const [storeSlug, sellerSlug] = window.location.pathname.split('/').filter(Boolean)
  return { storeSlug: storeSlug || demoPayload.store.slug, sellerSlug }
}
function cartKey(product: Product, selections: Record<string, string>) {
  return `${product.id}:${Object.entries(selections).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('|')}`
}
function Media({ product, className = '' }: { product: Product; className?: string }) {
  if (product.mediaType === 'video') return <video className={className} src={product.mediaUrl} autoPlay loop muted playsInline preload="metadata" />
  return <img className={className} src={product.mediaUrl} alt={product.name} />
}

export default function PublicStore() {
  const route = useMemo(routeParts, [])
  const [payload, setPayload] = useState<PublicPayload | null>(null)
  const [demo, setDemo] = useState(false)
  const [view, setView] = useState<ViewMode>('store')
  const [category, setCategory] = useState('Todos')
  const [query, setQuery] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [picker, setPicker] = useState<Product | null>(null)
  const [pickerQty, setPickerQty] = useState(1)
  const [pickerSelections, setPickerSelections] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('atacado-shop-cart-v2') || '[]') }
    catch { return [] }
  })

  useEffect(() => {
    let active = true
    api.publicStore(route.storeSlug, route.sellerSlug)
      .then((data) => {
        if (!active) return
        setPayload(data)
        setDemo(false)
        api.track({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, kind: 'view' })
      })
      .catch(() => {
        if (!active) return
        if (route.storeSlug === demoPayload.store.slug) {
          setPayload({ ...demoPayload, seller: route.sellerSlug === 'bianca' ? { slug: 'bianca', name: 'Bianca', phone: '5571888888888' } : demoPayload.seller })
          setDemo(true)
        }
      })
    return () => { active = false }
  }, [route.storeSlug, route.sellerSlug])

  useEffect(() => { localStorage.setItem('atacado-shop-cart-v2', JSON.stringify(cart)) }, [cart])

  const store = payload?.store
  const seller = payload?.seller
  const products = payload?.products || []
  const categories = useMemo(() => ['Todos', ...Array.from(new Set(products.map((product) => product.category)))], [products])
  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    const text = `${product.name} ${product.sku} ${product.category}`.toLowerCase()
    return matchesCategory && text.includes(query.trim().toLowerCase())
  })
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const minimum = store?.minimumOrder || 0
  const minimumReached = cartTotal >= minimum
  const minimumProgress = minimum <= 0 ? 100 : Math.min(100, (cartTotal / minimum) * 100)

  const openPicker = (product: Product) => {
    const defaults: Record<string, string> = {}
    product.variations.forEach((group) => { if (group.options.length === 1) defaults[group.name] = group.options[0] })
    setPicker(product)
    setPickerQty(1)
    setPickerSelections(defaults)
    setError('')
  }
  const confirmPicker = () => {
    if (!picker) return
    const missing = picker.variations.find((group) => !pickerSelections[group.name])
    if (missing) { setError(`Escolha ${missing.name.toLowerCase()}.`); return }
    const key = cartKey(picker, pickerSelections)
    setCart((current) => {
      const existing = current.find((item) => item.key === key)
      if (existing) return current.map((item) => item.key === key ? { ...item, quantity: item.quantity + pickerQty } : item)
      return [...current, { key, product: picker, quantity: pickerQty, selections: pickerSelections }]
    })
    api.track({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, kind: 'cart' })
    setPicker(null)
  }
  const changeQuantity = (key: string, delta: number) => {
    setCart((current) => current.map((item) => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0))
  }
  const sendOrder = async () => {
    if (!store || !minimumReached || !cart.length || sending) return
    setSending(true)
    setError('')
    try {
      if (demo) {
        const lines = cart.map((item) => {
          const variant = Object.values(item.selections).join(' · ')
          return `${item.quantity}x ${item.product.name}${variant ? ` (${variant})` : ''} — ${money.format(item.product.price * item.quantity)}`
        })
        const message = [`Olá! Montei este pedido na ${store.name}:`, '', ...lines, '', `Total: ${money.format(cartTotal)}`, '', 'Quero finalizar meu pedido.'].join('\n')
        window.open(`https://wa.me/${seller?.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
      } else {
        const result = await api.createOrder({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, selections: item.selections })) })
        window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.') }
    finally { setSending(false) }
  }

  if (!payload) {
    return <div className="store-loading"><span className="brand__mark">AS</span><strong>{route.storeSlug === demoPayload.store.slug ? 'Abrindo a loja…' : 'Loja não encontrada'}</strong><p>{route.storeSlug === demoPayload.store.slug ? 'Só um instante.' : 'Confira o endereço recebido da sua vendedora.'}</p></div>
  }

  return (
    <div className={`app ${view === 'feed' ? 'app--feed' : ''}`} style={{ '--accent': store?.accent || '#c94c2d' } as React.CSSProperties}>
      <header className="topbar">
        <button className="brand" onClick={() => setView('store')} aria-label="Voltar para a loja">
          {store?.logoUrl ? <img className="brand__logo" src={store.logoUrl} alt="" /> : <span className="brand__mark">AS</span>}
          <span className="brand__text"><strong>{store?.name}</strong><small>via Atacado Shop</small></span>
        </button>
        <nav className="view-switch" aria-label="Modo de navegação">
          <button className={view === 'store' ? 'is-active' : ''} onClick={() => setView('store')}><Grid2X2 size={16} /> Loja</button>
          <button className={view === 'feed' ? 'is-active' : ''} onClick={() => setView('feed')}><Sparkles size={16} /> Feed</button>
        </nav>
        <button className="cart-trigger" onClick={() => setCartOpen(true)}><ShoppingBag size={19} /><span>Carrinho</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
      </header>

      {view === 'store' ? (
        <main>
          <section className="store-intro"><div><p className="eyebrow">{store?.eyebrow}</p><h1>{store?.tagline}</h1></div><div className="seller-note"><span>Seu atendimento</span><strong>{seller?.name || 'Atendimento'}</strong><small>Seu carrinho vai direto para este atendimento.</small></div></section>
          <section className="catalog-toolbar"><label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto ou referência" /></label><div className="minimum-inline"><span>Pedido mínimo</span><strong>{money.format(minimum)}</strong></div></section>
          <section className="category-strip" aria-label="Categorias">{categories.map((item) => <button key={item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</section>
          <section className="catalog-heading"><div><span>{visibleProducts.length} produtos</span><h2>{category === 'Todos' ? 'Escolha suas peças' : category}</h2></div><button className="feed-callout" onClick={() => setView('feed')}>Ver como feed <ArrowRight size={17} /></button></section>
          <section className="product-grid">
            {visibleProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <button className="product-card__media" onClick={() => openPicker(product)} aria-label={`Ver ${product.name}`}><Media product={product} />{product.featured && <span className="product-card__flag">mais pedido</span>}<span className="heart-button"><Heart size={18} /></span></button>
                <div className="product-card__content"><div className="product-card__meta"><span>{product.sku}</span><span>{product.category}</span></div><h3>{product.name}</h3><p>{product.description}</p>{product.pack && <div className="product-card__pack">{product.pack}</div>}{product.variations.length > 0 && <div className="product-card__variations">{product.variations.map((group) => <span key={group.name}>{group.name}: {group.options.join(' / ')}</span>)}</div>}<div className="product-card__footer"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}><Plus size={18} /> Escolher</button></div></div>
              </article>
            ))}
          </section>
          {visibleProducts.length === 0 && <div className="empty-state"><h3>Nada por aqui.</h3><p>Tente outro nome, categoria ou referência.</p></div>}
        </main>
      ) : (
        <main className="feed-shell">
          <div className="feed-list">{products.map((product) => <article className="feed-card" key={product.id}><Media product={product} /><div className="feed-card__shade" /><div className="feed-card__top"><span>{product.category}</span><span>{product.sku}</span></div><div className="feed-card__actions"><button aria-label={`Favoritar ${product.name}`}><Heart size={22} /></button><button onClick={() => openPicker(product)} aria-label={`Escolher ${product.name}`}><Plus size={24} /></button></div><div className="feed-card__info"><span className="feed-card__seller">com {seller?.name || 'atendimento'}</span><h2>{product.name}</h2><p>{product.description}</p><div className="feed-card__buyline"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}>Escolher quantidade <ChevronRight size={18} /></button></div></div></article>)}</div>
          {cartCount > 0 && <button className="feed-cart" onClick={() => setCartOpen(true)}><span><ShoppingBag size={18} /> {cartCount} {cartCount === 1 ? 'item' : 'itens'}</span><strong>{money.format(cartTotal)}</strong></button>}
        </main>
      )}

      <div className={`drawer-backdrop ${cartOpen ? 'is-open' : ''}`} onClick={() => setCartOpen(false)} />
      <aside className={`cart-drawer ${cartOpen ? 'is-open' : ''}`} aria-hidden={!cartOpen}>
        <div className="cart-drawer__head"><div><small>Seu pedido</small><h2>Carrinho</h2></div><button onClick={() => setCartOpen(false)}><X size={22} /></button></div>
        <div className="cart-drawer__seller"><span>Atendimento atribuído</span><strong>{seller?.name || 'Atendimento'}</strong></div>
        <div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={30} /><h3>Seu carrinho está vazio.</h3><p>Escolha os produtos e defina quantidade e variação.</p></div> : cart.map((item) => <div className="cart-item" key={item.key}>{item.product.mediaType === 'image' ? <img src={item.product.mediaUrl} alt="" /> : <div className="cart-item__video">vídeo</div>}<div className="cart-item__main"><span>{item.product.sku}</span><strong>{item.product.name}</strong>{Object.keys(item.selections).length > 0 && <small>{Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ')}</small>}<small>{money.format(item.product.price)} cada</small></div><div className="quantity-control"><button onClick={() => changeQuantity(item.key, -1)}><Minus size={14} /></button><b>{item.quantity}</b><button onClick={() => changeQuantity(item.key, 1)}><Plus size={14} /></button></div></div>)}</div>
        <div className="cart-drawer__foot"><div className="minimum-box"><div className="minimum-box__copy">{minimumReached ? <span className="minimum-ok"><Check size={15} /> Pedido mínimo atingido</span> : <span>Faltam {money.format(Math.max(0, minimum - cartTotal))} para o mínimo</span>}<strong>{money.format(cartTotal)} / {money.format(minimum)}</strong></div><div className="minimum-track"><span style={{ width: `${minimumProgress}%` }} /></div></div><div className="cart-total"><span>Total dos produtos</span><strong>{money.format(cartTotal)}</strong></div>{error && <p className="form-error">{error}</p>}<button className="whatsapp-button" disabled={!minimumReached || cart.length === 0 || sending} onClick={sendOrder}>{sending ? 'Preparando pedido…' : `Enviar pedido para ${seller?.name || 'atendimento'}`}<ArrowRight size={19} /></button><p className="checkout-note">Pagamento, frete e detalhes são finalizados no WhatsApp.</p></div>
      </aside>

      {picker && <div className="picker-layer" role="dialog" aria-modal="true"><button className="picker-layer__backdrop" onClick={() => setPicker(null)} aria-label="Fechar" /><section className="product-picker"><button className="product-picker__close" onClick={() => setPicker(null)}><X size={20} /></button><div className="product-picker__media"><Media product={picker} /></div><div className="product-picker__body"><div className="product-picker__meta"><span>{picker.sku}</span><span>{picker.category}</span></div><h2>{picker.name}</h2><p>{picker.description}</p><strong className="product-picker__price">{money.format(picker.price)}</strong>{picker.variations.map((group) => <div className="variant-group" key={group.name}><div><strong>{group.name}</strong><span>{pickerSelections[group.name] || 'Escolha uma opção'}</span></div><div className="variant-options">{group.options.map((option) => <button key={option} className={pickerSelections[group.name] === option ? 'is-active' : ''} onClick={() => { setPickerSelections((current) => ({ ...current, [group.name]: option })); setError('') }}>{option}</button>)}</div></div>)}<div className="picker-quantity"><div><strong>Quantidade</strong><span>{money.format(picker.price * pickerQty)}</span></div><div className="quantity-control quantity-control--large"><button onClick={() => setPickerQty((value) => Math.max(1, value - 1))}><Minus size={16} /></button><b>{pickerQty}</b><button onClick={() => setPickerQty((value) => value + 1)}><Plus size={16} /></button></div></div>{error && <p className="form-error">{error}</p>}<button className="picker-add" onClick={confirmPicker}><ShoppingBag size={18} /> Adicionar {pickerQty} ao carrinho <span>{money.format(picker.price * pickerQty)}</span></button></div></section></div>}

      {view === 'store' && <button className="mobile-cart" onClick={() => setCartOpen(true)}><ShoppingBag size={18} /><span>{cartCount > 0 ? `${cartCount} itens · ${money.format(cartTotal)}` : 'Ver carrinho'}</span><ArrowLeft className="mobile-cart__arrow" size={17} /></button>}
    </div>
  )
}
