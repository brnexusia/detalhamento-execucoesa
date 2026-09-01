import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Grid2X2, Minus, Plus, Search, ShoppingBag, Sparkles, X } from 'lucide-react'
import { api } from './api'
import { demoPayload } from './data'
import type { CartItem, Product, PublicPayload } from './types'

type ViewMode = 'store' | 'feed'
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function routeParts() {
  const [storeSlug, sellerSlug] = window.location.pathname.split('/').filter(Boolean)
  return { storeSlug: storeSlug || demoPayload.store.slug, sellerSlug }
}

function requestedProductId() {
  return new URLSearchParams(window.location.search).get('produto')?.trim().slice(0, 100) || ''
}

function cartKey(product: Product, selections: Record<string, string>) {
  return `${product.id}:${Object.entries(selections).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('|')}`
}

function mediaUrl(product: Product) {
  return product.images?.[0] || product.mediaUrl
}

function matchingVariantImages(product: Product, selections: Record<string, string>) {
  const groups = Array.isArray(product.variantImages) ? product.variantImages : []
  const matches = groups.filter((group) => {
    const entries = Object.entries(group.selections || {})
    return entries.length > 0 && entries.every(([key, value]) => selections[key] === value)
  })
  const values = matches.flatMap((group) => group.images || [])
  return [...new Set(values.filter(Boolean))]
}

function galleryFor(product: Product, selections: Record<string, string>) {
  const variant = matchingVariantImages(product, selections)
  const base = [...(product.images || []), product.mediaType === 'image' ? product.mediaUrl : ''].filter(Boolean)
  return [...new Set([...variant, ...base])]
}

function ProductMedia({ product, className = '' }: { product: Product; className?: string }) {
  if (product.mediaType === 'video') return <video className={className} src={product.mediaUrl} autoPlay loop muted playsInline preload="metadata" />
  return <img className={className} src={mediaUrl(product)} alt={product.name} loading="lazy" decoding="async" />
}

export default function PublicStoreV2() {
  const route = useMemo(routeParts, [])
  const deepLinkedProductId = useMemo(requestedProductId, [])
  const deepLinkOpenedRef = useRef(false)
  const [payload, setPayload] = useState<PublicPayload | null>(null)
  const [demo, setDemo] = useState(false)
  const [view, setView] = useState<ViewMode>('store')
  const [category, setCategory] = useState('Todos')
  const [query, setQuery] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [picker, setPicker] = useState<Product | null>(null)
  const [pickerQty, setPickerQty] = useState(1)
  const [pickerSelections, setPickerSelections] = useState<Record<string, string>>({})
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [filterLoading, setFilterLoading] = useState(false)
  const filterKeyRef = useRef('Todos|')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('atacado-shop-cart-v3') || '[]') }
    catch { return [] }
  })

  const loadFirst = useCallback(() => {
    setCategory('Todos')
    setQuery('')
    filterKeyRef.current = 'Todos|'
    return api.publicStore(route.storeSlug, route.sellerSlug)
      .then((data) => {
        setPayload(data)
        setDemo(false)
        setCatalogError('')
        api.track({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, kind: 'view' })
      })
      .catch(() => {
        if (route.storeSlug === demoPayload.store.slug) {
          setPayload({ ...demoPayload, seller: route.sellerSlug === 'bianca' ? { slug: 'bianca', name: 'Bianca', phone: '5571888888888' } : demoPayload.seller })
          setDemo(true)
        }
      })
  }, [route.storeSlug, route.sellerSlug])

  useEffect(() => { void loadFirst() }, [loadFirst])
  useEffect(() => { localStorage.setItem('atacado-shop-cart-v3', JSON.stringify(cart)) }, [cart])

  useEffect(() => {
    if (!payload || demo) return
    const key = `${category}|${query.trim()}`
    if (filterKeyRef.current === key) return
    const timer = window.setTimeout(() => {
      setFilterLoading(true)
      setCatalogError('')
      api.publicStore(route.storeSlug, route.sellerSlug, {
        q: query.trim() || undefined,
        category: category === 'Todos' ? undefined : category,
      }).then((data) => {
        filterKeyRef.current = key
        setPayload(data)
      }).catch((err) => setCatalogError(err instanceof Error ? err.message : 'Não foi possível carregar os produtos.'))
        .finally(() => setFilterLoading(false))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [category, query, demo, payload?.store.slug, route.storeSlug, route.sellerSlug])

  const store = payload?.store
  const seller = payload?.seller
  const products = payload?.products || []
  const categories = useMemo(() => {
    const source = payload?.categories?.length ? payload.categories : Array.from(new Set(products.map((product) => product.category)))
    return ['Todos', ...source.filter((item) => item && item !== 'Todos')]
  }, [payload?.categories, products])
  const visibleProducts = demo ? products.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    return matchesCategory && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query.trim().toLowerCase())
  }) : products
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const minimum = store?.minimumOrder || 0
  const minimumReached = cartTotal >= minimum
  const minimumProgress = minimum <= 0 ? 100 : Math.min(100, (cartTotal / minimum) * 100)

  const loadMore = useCallback(async () => {
    const cursor = payload?.page?.nextCursor
    if (demo || loadingMore || !payload?.page?.hasMore || !cursor) return
    setLoadingMore(true)
    try {
      const data = await api.publicStore(route.storeSlug, route.sellerSlug, {
        cursor,
        q: query.trim() || undefined,
        category: category === 'Todos' ? undefined : category,
      })
      setPayload((current) => {
        if (!current) return data
        const seen = new Set(current.products.map((item) => item.id))
        return { ...current, categories: data.categories || current.categories, products: [...current.products, ...data.products.filter((item) => !seen.has(item.id))], page: data.page }
      })
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Não foi possível carregar mais produtos.')
    } finally { setLoadingMore(false) }
  }, [payload?.page, demo, loadingMore, route.storeSlug, route.sellerSlug, query, category])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || demo || loadingMore || !payload?.page?.hasMore) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore() }, { rootMargin: '700px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [loadMore, demo, loadingMore, payload?.page?.hasMore, view])

  const openPicker = (product: Product) => {
    const defaults: Record<string, string> = {}
    product.variations.forEach((group) => { if (group.options.length === 1) defaults[group.name] = group.options[0] })
    setPicker(product)
    setPickerQty(1)
    setPickerSelections(defaults)
    setGalleryIndex(0)
    setError('')
  }

  useEffect(() => {
    if (!deepLinkedProductId || deepLinkOpenedRef.current || !payload || demo) return
    deepLinkOpenedRef.current = true
    fetch(`/api/social/stores/${encodeURIComponent(route.storeSlug)}/products/${encodeURIComponent(deepLinkedProductId)}`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => { if (body?.product) openPicker(body.product as Product) })
      .catch(() => undefined)
  }, [deepLinkedProductId, payload, demo, route.storeSlug])

  const pickerGallery = picker ? galleryFor(picker, pickerSelections) : []
  useEffect(() => { setGalleryIndex(0) }, [pickerSelections, picker?.id])

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

  const sendOrder = async () => {
    if (!store || !minimumReached || !cart.length || sending) return
    setSending(true); setError('')
    try {
      if (demo) return
      const result = await api.createOrder({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, selections: item.selections })) })
      window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.') }
    finally { setSending(false) }
  }

  if (!payload) return <div className="store-loading"><span className="brand__mark">AS</span><strong>Abrindo a loja…</strong><p>Só um instante.</p></div>

  return <div className={`app ${view === 'feed' ? 'app--feed' : ''}`} style={{ '--accent': store?.accent || '#c94c2d' } as React.CSSProperties}>
    <header className="topbar">
      <button className="brand" onClick={() => setView('store')}>{store?.logoUrl ? <img className="brand__logo" src={store.logoUrl} alt="" /> : <span className="brand__mark">AS</span>}<span className="brand__text"><strong>{store?.name}</strong><small>via Atacado Shop</small></span></button>
      <nav className="view-switch"><button className={view === 'store' ? 'is-active' : ''} onClick={() => setView('store')}><Grid2X2 size={16}/> Loja</button><button className={view === 'feed' ? 'is-active' : ''} onClick={() => { setCategory('Todos'); setQuery(''); setView('feed') }}><Sparkles size={16}/> Feed</button></nav>
      <button className="cart-trigger" onClick={() => setCartOpen(true)}><ShoppingBag size={19}/><span>Carrinho</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
    </header>

    {view === 'store' ? <main>
      <section className="store-intro"><div><p className="eyebrow">{store?.eyebrow}</p><h1>{store?.tagline}</h1></div><div className="seller-note"><span>Seu atendimento</span><strong>{seller?.name || 'Atendimento'}</strong><small>Seu carrinho vai direto para este atendimento.</small></div></section>
      <section className="catalog-toolbar"><label className="search-box"><Search size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto ou referência" /></label><div className="minimum-inline"><span>Pedido mínimo</span><strong>{money.format(minimum)}</strong></div></section>
      <section className="category-strip">{categories.map((item) => <button key={item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</section>
      <section className="catalog-heading"><div><span>{payload.page?.hasMore ? 'Mais produtos disponíveis' : `${visibleProducts.length} produtos`}</span><h2>{category === 'Todos' ? 'Escolha suas peças' : category}</h2></div><button className="feed-callout" onClick={() => setView('feed')}>Ver como feed <ArrowRight size={17}/></button></section>
      <section className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><button className="product-card__media" onClick={() => openPicker(product)}><ProductMedia product={product}/>{product.featured && <span className="product-card__flag">mais pedido</span>}</button><div className="product-card__content"><div className="product-card__meta"><span>{product.sku}</span><span>{product.category}</span></div><h3>{product.name}</h3><p>{product.description}</p>{product.variations.length > 0 && <div className="product-card__variations">{product.variations.map((group) => <span key={group.name}>{group.name}: {group.options.join(' / ')}</span>)}</div>}<div className="product-card__footer"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}><Plus size={18}/> Escolher</button></div></div></article>)}</section>
      {!demo && <div ref={loadMoreRef} style={{height: 1}}/>}
      {(filterLoading || loadingMore) && <div className="empty-state"><p>Carregando produtos…</p></div>}
      {catalogError && <div className="empty-state"><p>{catalogError}</p></div>}
    </main> : <main className="feed-shell"><div className="feed-list">{products.map((product) => <article className="feed-card" key={product.id}><ProductMedia product={product}/><div className="feed-card__shade"/><div className="feed-card__top"><span>{product.category}</span><span>{product.sku}</span></div><div className="feed-card__actions"><button onClick={() => openPicker(product)}><Plus size={24}/></button></div><div className="feed-card__info"><span className="feed-card__seller">com {seller?.name || 'atendimento'}</span><h2>{product.name}</h2><p>{product.description}</p><div className="feed-card__buyline"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}>Escolher quantidade <ChevronRight size={18}/></button></div></div></article>)}{!demo && <div ref={loadMoreRef}/>}</div></main>}

    <div className={`drawer-backdrop ${cartOpen ? 'is-open' : ''}`} onClick={() => setCartOpen(false)}/>
    <aside className={`cart-drawer ${cartOpen ? 'is-open' : ''}`}><div className="cart-drawer__head"><div><small>Seu pedido</small><h2>Carrinho</h2></div><button onClick={() => setCartOpen(false)}><X size={22}/></button></div><div className="cart-drawer__seller"><span>Atendimento atribuído</span><strong>{seller?.name || 'Atendimento'}</strong></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={30}/><h3>Seu carrinho está vazio.</h3></div> : cart.map((item) => <div className="cart-item" key={item.key}><img src={mediaUrl(item.product)} alt=""/><div className="cart-item__main"><span>{item.product.sku}</span><strong>{item.product.name}</strong><small>{Object.entries(item.selections).map(([k,v]) => `${k}: ${v}`).join(' · ')}</small><small>{money.format(item.product.price)} cada</small></div><div className="quantity-control"><button onClick={() => setCart((current) => current.map((x) => x.key === item.key ? {...x, quantity: Math.max(0, x.quantity - 1)} : x).filter((x) => x.quantity > 0))}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => setCart((current) => current.map((x) => x.key === item.key ? {...x, quantity: x.quantity + 1} : x))}><Plus size={14}/></button></div></div>)}</div><div className="cart-drawer__foot"><div className="minimum-box"><div className="minimum-box__copy">{minimumReached ? <span className="minimum-ok"><Check size={15}/> Pedido mínimo atingido</span> : <span>Faltam {money.format(Math.max(0, minimum - cartTotal))}</span>}<strong>{money.format(cartTotal)} / {money.format(minimum)}</strong></div><div className="minimum-track"><span style={{width: `${minimumProgress}%`}}/></div></div><div className="cart-total"><span>Total dos produtos</span><strong>{money.format(cartTotal)}</strong></div>{error && <p className="form-error">{error}</p>}<button className="whatsapp-button" disabled={!minimumReached || !cart.length || sending} onClick={sendOrder}>{sending ? 'Preparando pedido…' : `Enviar pedido para ${seller?.name || 'atendimento'}`}<ArrowRight size={19}/></button></div></aside>

    {picker && <div className="picker-layer"><button className="picker-layer__backdrop" onClick={() => setPicker(null)}/><section className="product-picker"><button className="product-picker__close" onClick={() => setPicker(null)}><X size={20}/></button><div className="product-picker__media product-gallery"><div className="product-gallery__stage">{picker.mediaType === 'video' && !pickerGallery.length ? <video src={picker.mediaUrl} controls playsInline/> : <img src={pickerGallery[galleryIndex] || mediaUrl(picker)} alt={picker.name}/>} {pickerGallery.length > 1 && <><button className="product-gallery__prev" onClick={() => setGalleryIndex((i) => (i - 1 + pickerGallery.length) % pickerGallery.length)}><ChevronLeft size={20}/></button><button className="product-gallery__next" onClick={() => setGalleryIndex((i) => (i + 1) % pickerGallery.length)}><ChevronRight size={20}/></button></>}</div>{pickerGallery.length > 1 && <div className="product-gallery__thumbs">{pickerGallery.map((url, index) => <button key={url} className={index === galleryIndex ? 'is-active' : ''} onClick={() => setGalleryIndex(index)}><img src={url} alt="" loading="lazy"/></button>)}</div>}</div><div className="product-picker__body"><div className="product-picker__meta"><span>{picker.sku}</span><span>{picker.category}</span></div><h2>{picker.name}</h2><p>{picker.description}</p><strong className="product-picker__price">{money.format(picker.price)}</strong>{picker.variations.map((group) => <div className="variant-group" key={group.name}><div><strong>{group.name}</strong><span>{pickerSelections[group.name] || 'Escolha uma opção'}</span></div><div className="variant-options">{group.options.map((option) => <button key={option} className={pickerSelections[group.name] === option ? 'is-active' : ''} onClick={() => { setPickerSelections((current) => ({...current, [group.name]: option})); setError('') }}>{option}</button>)}</div></div>)}<div className="picker-quantity"><div><strong>Quantidade</strong><span>{money.format(picker.price * pickerQty)}</span></div><div className="quantity-control quantity-control--large"><button onClick={() => setPickerQty((v) => Math.max(1, v - 1))}><Minus size={16}/></button><b>{pickerQty}</b><button onClick={() => setPickerQty((v) => v + 1)}><Plus size={16}/></button></div></div>{error && <p className="form-error">{error}</p>}<button className="picker-add" onClick={confirmPicker}><ShoppingBag size={18}/> Adicionar {pickerQty} ao carrinho <span>{money.format(picker.price * pickerQty)}</span></button></div></section></div>}

    {view === 'store' && <button className="mobile-cart" onClick={() => setCartOpen(true)}><ShoppingBag size={18}/><span>{cartCount > 0 ? `${cartCount} itens · ${money.format(cartTotal)}` : 'Ver carrinho'}</span><ArrowLeft className="mobile-cart__arrow" size={17}/></button>}
  </div>
}
