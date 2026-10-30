import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Grid2X2, ImageOff, Minus, Plus, Search, ShoppingBag, Menu, Sparkles, Heart, MessageCircle, Share2, X } from 'lucide-react'
import { api } from './api'
import { ProductGrade, getGradeGroups, type GradeLine } from './ShopvaxGrade'
import ShopvaxCheckoutReview, { type CheckoutBuyer } from './ShopvaxCheckoutReview'
import ShopvaxOrderReady from './ShopvaxOrderReady'
import { SHOPVAX_DEFAULT_ACCENT, shopvaxAccentTextColor, SVBrandSignature, SVRibbon, SVTicker, SVStamp, SVTag } from './ShopvaxDesignSystem'
import { demoPayload } from './data'
import StoreSocialNav from './StoreSocialNav'
import CustomerAccountLauncher from './CustomerAccountLauncher'
import './shopvax-store-layout-fixes.css'
import './shopvax-desktop-product-page.css'
import './shopvax-desktop-ticket-05.css'
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

function ResilientImage({ src, alt, className = '', loading = 'lazy' }: { src?: string; alt: string; className?: string; loading?: 'eager' | 'lazy' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) return <div className={`media-fallback ${className}`} role="img" aria-label={alt}><ImageOff size={28}/><span>Imagem indisponível</span></div>
  return <img className={className} src={src} alt={alt} loading={loading} decoding="async" onError={() => setFailed(true)} />
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
  return [...new Set(variant.length ? variant : base)]
}

function FeedCaption({ description }: { description: string }) {
  if (!description) return null
  if (description.length <= 85) return <p className="svx-feed-caption__short">{description}</p>
  return <details className="svx-feed-caption">
    <summary><span className="svx-feed-caption__preview">{description}</span><span className="svx-feed-caption__more">Mais</span><span className="svx-feed-caption__less">Ver menos</span></summary>
    <p>{description}</p>
  </details>
}

function ProductMedia({ product, className = '' }: { product: Product; className?: string }) {
  if (product.mediaType === 'video') return <video className={className} src={product.mediaUrl} autoPlay loop muted playsInline preload="metadata" />
  return <ResilientImage className={className} src={mediaUrl(product)} alt={product.name} />
}

export default function PublicStoreV2() {
  const route = useMemo(routeParts, [])
  const cartStorageKey = useMemo(() => `shopvax-cart-v1:${encodeURIComponent(route.storeSlug)}`, [route.storeSlug])
  const deepLinkedProductId = useMemo(requestedProductId, [])
  const deepLinkOpenedRef = useRef(false)
  const [payload, setPayload] = useState<PublicPayload | null>(null)
  const [demo, setDemo] = useState(false)
  const [view, setView] = useState<ViewMode>('store')
  const [storeNavOpen, setStoreNavOpen] = useState(false)
  const [category, setCategory] = useState('Todos')
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest')
  const [query, setQuery] = useState('')
  const [savedProducts, setSavedProducts] = useState<string[]>(() => {
    try { const items = JSON.parse(localStorage.getItem(`shopvax-favorites-v1:${route.storeSlug}`) || '[]'); return Array.isArray(items) ? items.filter((id) => typeof id === 'string') : [] } catch { return [] }
  })
  const [feedNotice, setFeedNotice] = useState('')
  const toggleSaved = (id: string) => setSavedProducts((items) => items.includes(id) ? items.filter((x) => x !== id) : [...items, id])
  const shareProduct = async (product: Product) => {
    const url = new URL(window.location.href)
    url.searchParams.set('produto', product.id)
    try {
      if (navigator.share) await navigator.share({ title: product.name, text: `Veja ${product.name} na ${store?.name || 'loja'}`, url: url.toString() })
      else { await navigator.clipboard.writeText(url.toString()); setFeedNotice('Link do produto copiado.') }
    } catch { setFeedNotice('Não foi possível compartilhar agora.') }
  }
  const askProduct = (product: Product) => {
    const phone = (seller?.phone || store?.whatsapp || '').replace(/\D/g, '')
    if (!phone) { setFeedNotice('A loja ainda não cadastrou atendimento por WhatsApp.'); return }
    const message = `Olá! Tenho uma dúvida sobre ${product.name} (ref. ${product.sku || product.id}).`
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }
  const [cartOpen, setCartOpen] = useState(false)
  const [picker, setPicker] = useState<Product | null>(null)
  const [pickerQty, setPickerQty] = useState(1)
  const [gradeMode, setGradeMode] = useState(false)
  const [pickerSelections, setPickerSelections] = useState<Record<string, string>>({})
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const preparedOrderRef = useRef<{ signature: string; url: string; code: string } | null>(null)
  const [readyOrder, setReadyOrder] = useState<{ code: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [filterLoading, setFilterLoading] = useState(false)
  const filterKeyRef = useRef('Todos||newest')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!picker) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [picker?.id])

  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(cartStorageKey) || '[]') }
    catch { return [] }
  })

  const loadFirst = useCallback(() => {
    setCategory('Todos')
    setQuery('')
    filterKeyRef.current = 'Todos||newest'
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
  useEffect(() => { localStorage.setItem(`shopvax-favorites-v1:${route.storeSlug}`, JSON.stringify(savedProducts)) }, [route.storeSlug, savedProducts])
  useEffect(() => { if (!feedNotice) return; const timer = window.setTimeout(() => setFeedNotice(''), 2600); return () => window.clearTimeout(timer) }, [feedNotice])
  useEffect(() => { localStorage.setItem(cartStorageKey, JSON.stringify(cart)); window.dispatchEvent(new CustomEvent('shopvax:cart-change', { detail: { storeSlug: route.storeSlug } })) }, [cart, cartStorageKey, route.storeSlug])

  useEffect(() => {
    if (!payload || demo) return
    const key = `${category}|${query.trim()}|${sort}`
    if (filterKeyRef.current === key) return
    const timer = window.setTimeout(() => {
      setFilterLoading(true)
      setCatalogError('')
      api.publicStore(route.storeSlug, route.sellerSlug, {
        q: query.trim() || undefined,
        category: category === 'Todos' ? undefined : category,
        sort,
      }).then((data) => {
        filterKeyRef.current = key
        setPayload(data)
      }).catch((err) => setCatalogError(err instanceof Error ? err.message : 'Não foi possível carregar os produtos.'))
        .finally(() => setFilterLoading(false))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [category, query, sort, demo, payload?.store.slug, route.storeSlug, route.sellerSlug])

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
  }).sort((a,b) => sort === 'price_asc' ? a.price-b.price : sort === 'price_desc' ? b.price-a.price : 0) : products
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
        sort,
      })
      setPayload((current) => {
        if (!current) return data
        const seen = new Set(current.products.map((item) => item.id))
        return { ...current, categories: data.categories || current.categories, products: [...current.products, ...data.products.filter((item) => !seen.has(item.id))], page: data.page }
      })
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Não foi possível carregar mais produtos.')
    } finally { setLoadingMore(false) }
  }, [payload?.page, demo, loadingMore, route.storeSlug, route.sellerSlug, query, category, sort])

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
    setGradeMode(false)
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
    setFeedNotice('NA GRADE')
  }

  const addGradeLines = (lines: GradeLine[]) => {
    if (!picker || !lines.length) return
    setCart((current) => {
      const next = [...current]
      for (const line of lines) {
        const key = cartKey(picker, line.selections)
        const idx = next.findIndex((item) => item.key === key)
        if (idx >= 0) next[idx] = { ...next[idx], quantity: next[idx].quantity + line.quantity }
        else next.push({ key, product: picker, quantity: line.quantity, selections: line.selections })
      }
      return next
    })
    api.track({ storeSlug: route.storeSlug, sellerSlug: route.sellerSlug, kind: 'cart' })
    setError('')
    setPicker(null)
    setFeedNotice('NA GRADE')
  }

  const sendOrder = async (buyer: CheckoutBuyer, notes: string) => {
    if (!store || !minimumReached || !cart.length || sending || demo) return
    const signature = JSON.stringify({
      store: route.storeSlug,
      seller: route.sellerSlug || '',
      items: cart.map(item => ({ id: item.product.id, quantity: item.quantity, selections: item.selections })),
      buyer, notes,
    })
    const previous = preparedOrderRef.current
    if (previous?.signature === signature) {
      setReadyOrder({ code: previous.code, url: previous.url })
      setReviewOpen(false)
      setCartOpen(false)
      return
    }
    setSending(true)
    setError('')
    try {
      const result = await api.createOrder({
        storeSlug: route.storeSlug,
        sellerSlug: route.sellerSlug,
        items: cart.map(item => ({ productId: item.product.id, quantity: item.quantity, selections: item.selections })),
        buyer, notes,
      })
      preparedOrderRef.current = { signature, url: result.whatsappUrl, code: result.code }
      setReadyOrder({ code: result.code, url: result.whatsappUrl })
      setReviewOpen(false)
      setCartOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível preparar o pedido.')
    } finally {
      setSending(false)
    }
  }

  if (!payload) return <div className="store-loading"><span className="brand__mark"><img src="/brand/shopvax-symbol.svg" className="svx-brand-symbol" alt="Shopvax" /></span><strong>Abrindo a loja…</strong><p>Só um instante.</p></div>

  return <div className={`app ${view === 'feed' ? 'app--feed' : ''}`} style={{ '--accent': store?.accent || SHOPVAX_DEFAULT_ACCENT, '--svx-accent-text': shopvaxAccentTextColor(store?.accent || SHOPVAX_DEFAULT_ACCENT) } as React.CSSProperties}>
    <header className="topbar">
      <button className="brand" onClick={() => setView('store')}>{store?.logoUrl ? <img className="brand__logo" src={store.logoUrl} alt="" /> : <span className="brand__mark" aria-hidden="true">{(store?.name || 'L').slice(0, 1).toUpperCase()}</span>}<span className="brand__text"><strong>{store?.name}</strong><small>Catálogo de atacado</small></span></button>
      <button type="button" className="store-nav-toggle" aria-controls="shopvax-store-navigation" aria-expanded={storeNavOpen} onClick={() => setStoreNavOpen(value => !value)}><Menu size={18}/><span>Menu</span></button>
      <div id="shopvax-store-navigation" className={`store-header-navigation ${storeNavOpen?'is-open':''}`} onClick={(event) => { if ((event.target as HTMLElement).closest('button')) setStoreNavOpen(false) }}>
        <nav className="view-switch"><button className={view === 'store' ? 'is-active' : ''} onClick={() => setView('store')}><Grid2X2 size={16}/> Loja</button><button className={view === 'feed' ? 'is-active' : ''} onClick={() => { setCategory('Todos'); setQuery(''); setView('feed') }}><Sparkles size={16}/> Feed</button></nav>
        <StoreSocialNav />
        <CustomerAccountLauncher />
      </div>
      <button className="cart-trigger" onClick={() => setCartOpen(true)}><ShoppingBag size={19}/><span>Carrinho</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
    </header>

    {view === 'store' ? <main>
      <section className="store-intro svx-vitrine">
        <div className="svx-vitrine__media" aria-hidden="true">{products[0] && <ProductMedia product={products[0]}/>}</div>
        <div className="svx-vitrine__shade" aria-hidden="true"/>
        <SVTicker className="store-intro__ribbon"><span>Preço à vista · Pedido via WhatsApp</span><span>{minimum > 0 ? `Pedido mínimo ${money.format(minimum)}` : 'Seu pedido, sua grade'}</span></SVTicker>
        <div className="store-intro__identity">{store?.logoUrl && <img className="store-intro__logo" src={store.logoUrl} alt={`Logo da loja ${store.name}`} />}<p className="eyebrow">{store?.eyebrow || 'Catálogo de atacado'}</p><h1>{store?.name}</h1><p className="store-intro__tagline">{store?.tagline}</p>
          <div className="svx-vitrine__facts"><span><strong>{visibleProducts.length}{payload.page?.hasMore ? '+' : ''}</strong> referências</span><span><strong>{money.format(minimum)}</strong> pedido mínimo</span><span><strong>WhatsApp</strong> atendimento</span></div>
          <div className="svx-vitrine__actions"><button onClick={() => document.getElementById('colecao-atual')?.scrollIntoView({ behavior: 'smooth' })}>Ver catálogo <ArrowRight size={16}/></button><button onClick={() => setView('feed')}>Passar uma por uma <ArrowRight size={16}/></button></div>
        </div><div className="seller-note"><span>Seu atendimento</span><strong>{seller?.name || 'Atendimento'}</strong><small>Monte o pedido e converse direto com sua vendedora.</small></div>
      </section>
      <section className="svx-discovery" aria-label="Peças em destaque da coleção">
        <div className="svx-discovery__heading"><div><span className="svx-kicker">SUA VITRINE, SEM COMPLICAÇÃO</span><h2>Acabou de chegar na seleção</h2></div><button onClick={() => document.getElementById('colecao-atual')?.scrollIntoView({ behavior:'smooth' })}>Ver coleção <ArrowRight size={16}/></button></div>
        <div className="svx-discovery__rail">{visibleProducts.slice(0,6).map((product) => <button type="button" key={product.id} onClick={() => openPicker(product)}><span className="svx-discovery__image"><ProductMedia product={product}/></span><small>{product.sku || product.category}</small><strong>{product.name}</strong><b>{money.format(product.price)}</b></button>)}</div>
      </section>
      {visibleProducts.some((product) => product.featured) && <section className="svx-highlights" aria-label="Destaques da loja"><h2>Destaques da loja</h2><div>{visibleProducts.filter((product)=>product.featured).slice(0,3).map((product,index)=><button key={product.id} onClick={() => openPicker(product)}><span>{String(index+1).padStart(2,'0')}</span><strong>{product.name}</strong><small>{money.format(product.price)}</small><ArrowRight size={16}/></button>)}</div></section>}
      <div className="svx-catalog-split"><div className="svx-catalog-split__products">
      <section className="catalog-toolbar"><label className="search-box"><Search size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto ou referência" /></label><label className="svx-catalog-sort"><span>Ordenar por</span><select aria-label="Ordenação dos produtos" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'price_asc' | 'price_desc')}><option value="newest">Mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option></select></label><div className="minimum-inline"><span>Pedido mínimo</span><strong>{money.format(minimum)}</strong></div></section>
      <section className="category-strip">{categories.map((item) => <button key={item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</section>
      <section id="colecao-atual" className="catalog-heading"><div><span>{payload.page?.hasMore ? 'Mais produtos disponíveis' : `${visibleProducts.length} produtos`}</span><h2>{category === 'Todos' ? 'Escolha suas peças' : category}</h2></div><button className="feed-callout" onClick={() => setView('feed')}>Ver como feed <ArrowRight size={17}/></button></section>
      {!visibleProducts.length && !filterLoading && <div className="svx-catalog-empty"><Search size={28}/><h3>Nenhuma peça encontrada.</h3><p>Experimente outra referência, categoria ou termo de busca.</p><button onClick={() => { setQuery(''); setCategory('Todos'); setSort('newest') }}>Limpar filtros</button></div>}
      <section className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><button className="product-card__media" onClick={() => openPicker(product)} aria-label={`Ver ${product.name}`}><ProductMedia product={product}/>{product.featured && <SVTag className="product-card__flag">Destaque</SVTag>}</button><div className="product-card__content"><div className="product-card__meta"><span>{product.sku}</span><span>{product.category}</span></div><h3>{product.name}</h3><p>{product.description}</p>{product.variations.length > 0 && <div className="product-card__variations">{product.variations.map((group) => <span key={group.name}>{group.name}: {group.options.join(' / ')}</span>)}</div>}<div className="product-card__footer"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}><Plus size={18}/> Escolher</button></div></div></article>)}</section>
      {!demo && <div ref={loadMoreRef} style={{height: 1}}/>}
      {(filterLoading || loadingMore) && <div className="empty-state"><p>Carregando produtos…</p></div>}
      {catalogError && <div className="empty-state"><p>{catalogError}</p></div>}
      <footer className="store-brand-signature"><SVBrandSignature /></footer>
      </div>
      <aside className="svx-desktop-ticket" aria-label="Seu pedido durante a compra">
        <div className="svx-desktop-ticket__top"><span>Pedido em andamento</span><small>{String(cartCount).padStart(2,'0')} peças</small></div>
        <h2>Seu pedido</h2>
        <div className="svx-desktop-ticket__items">
          {cart.length ? cart.map((item) => <button className="svx-desktop-ticket__item" type="button" key={item.key} onClick={() => openPicker(item.product)} aria-label={`Ver ${item.product.name} no pedido`}>
            <span className="svx-desktop-ticket__thumb"><ResilientImage src={galleryFor(item.product,item.selections)[0]||mediaUrl(item.product)} alt="" /></span>
            <span className="svx-desktop-ticket__details"><strong>{item.product.name}</strong><small>REF. {item.product.sku || '—'} · {Object.values(item.selections).join(' / ') || 'Sem variação'}</small><small>{item.quantity} {item.quantity === 1 ? 'peça' : 'peças'}</small></span>
            <span className="svx-desktop-ticket__price">{money.format(item.quantity * item.product.price)}</span>
          </button>) : <p className="svx-desktop-ticket__empty">Escolha uma peça da coleção e ela aparece aqui, sem sair do catálogo.</p>}
        </div>
        <div className="svx-desktop-ticket__bottom">
          <div className="svx-desktop-ticket__progress-label"><span>{minimumReached ? 'MÍNIMO ATINGIDO' : 'PARA O PEDIDO MÍNIMO'}</span>{!minimumReached && <strong>{money.format(Math.max(0,minimum-cartTotal))}</strong>}</div>
          <div className="svx-desktop-ticket__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(minimumProgress)} aria-label="Progresso do pedido mínimo"><span style={{width:`${minimumProgress}%`}} /></div>
          <div className="svx-desktop-ticket__total"><span>TOTAL DAS PEÇAS</span><strong>{money.format(cartTotal)}</strong></div>
          <button type="button" className="svx-desktop-ticket__review" disabled={!cart.length || !minimumReached || sending} onClick={() => { setError(''); setReviewOpen(true) }}>Revisar e mandar <ArrowRight size={17} /></button>
          {!minimumReached && <small className="svx-desktop-ticket__hint">Faltam {money.format(Math.max(0,minimum-cartTotal))} para atingir o pedido mínimo.</small>}
          <p className="svx-desktop-ticket__notice">Pedido enviado à vendedora somente após sua confirmação no WhatsApp.</p>
        </div>
      </aside></div>
    </main> : <main className="feed-shell"><div className="feed-list">{products.map((product) => <article className="feed-card" key={product.id}><ProductMedia product={product}/><div className="feed-card__shade"/><div className="feed-card__top"><span>{product.category}</span><span>{product.sku}</span></div><div className="feed-card__actions"><button aria-label={`Montar grade de ${product.name}`} onClick={() => openPicker(product)}><Plus size={24}/><span>GRADE</span></button><button type="button" aria-pressed={savedProducts.includes(product.id)} aria-label={savedProducts.includes(product.id) ? `Remover ${product.name} dos salvos` : `Salvar ${product.name}`} onClick={() => toggleSaved(product.id)}><Heart size={22} fill={savedProducts.includes(product.id) ? 'currentColor' : 'none'}/><span>SALVAR</span></button><button type="button" aria-label={`Compartilhar ${product.name}`} onClick={() => void shareProduct(product)}><Share2 size={22}/><span>ENVIAR</span></button><button type="button" aria-label={`Perguntar sobre ${product.name}`} onClick={() => askProduct(product)}><MessageCircle size={22}/><span>PERGUNTAR</span></button></div><div className="feed-card__info"><span className="feed-card__seller">com {seller?.name || 'atendimento'}</span><h2>{product.name}</h2><FeedCaption description={product.description}/><div className="feed-card__buyline"><strong>{money.format(product.price)}</strong><button onClick={() => openPicker(product)}>Escolher quantidade <ChevronRight size={18}/></button></div></div></article>)}{!demo && <div ref={loadMoreRef}/>}</div></main>}

    <div className={`drawer-backdrop ${cartOpen ? 'is-open' : ''}`} onClick={() => setCartOpen(false)}/>
    <aside className={`cart-drawer ${cartOpen ? 'is-open' : ''}`}><div className="cart-drawer__head"><div><small>Seu pedido</small><h2>Seu pedido</h2>{cartCount > 0 && <SVStamp key={cartCount}>NA GRADE</SVStamp>}</div><button onClick={() => setCartOpen(false)} aria-label="Fechar carrinho"><X size={22}/></button></div><div className="cart-drawer__seller"><span>Talão digital · Atendimento atribuído</span><strong>{seller?.name || 'Atendimento'}</strong></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingBag size={30}/><h3>Seu carrinho está vazio.</h3></div> : cart.map((item) => <div className="cart-item" key={item.key}><ResilientImage src={galleryFor(item.product, item.selections)[0] || mediaUrl(item.product)} alt={item.product.name}/><div className="cart-item__main"><span>{item.product.sku}</span><strong>{item.product.name}</strong><small>{Object.entries(item.selections).map(([k,v]) => `${k}: ${v}`).join(' · ')}</small><small>{money.format(item.product.price)} cada</small></div><div className="quantity-control"><button onClick={() => setCart((current) => current.map((x) => x.key === item.key ? {...x, quantity: Math.max(0, x.quantity - 1)} : x).filter((x) => x.quantity > 0))} aria-label={`Diminuir quantidade de ${item.product.name}`}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => setCart((current) => current.map((x) => x.key === item.key ? {...x, quantity: x.quantity + 1} : x))} aria-label={`Aumentar quantidade de ${item.product.name}`}><Plus size={14}/></button></div></div>)}</div><div className="cart-drawer__foot"><div className="minimum-box"><div className="minimum-box__copy">{minimumReached ? <span className="minimum-ok"><Check size={15}/> Pedido mínimo atingido</span> : <span>Faltam {money.format(Math.max(0, minimum - cartTotal))}</span>}<strong>{money.format(cartTotal)} / {money.format(minimum)}</strong></div><div className={`minimum-track ${minimumReached ? 'is-reached' : ''}`} role="progressbar" aria-label="Progresso do pedido mínimo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(minimumProgress)}><span style={{width: `${minimumProgress}%`}}/><div className="svx-minimum-segments" aria-hidden="true">{Array.from({ length: 20 }, (_, n) => <i key={n} className={minimumProgress >= (n + 1) * 5 ? 'is-filled' : ''} />)}</div></div></div><div className="cart-total"><span>Total dos produtos</span><strong>{money.format(cartTotal)}</strong></div>{error && <p className="form-error">{error}</p>}<button className="whatsapp-button" disabled={!minimumReached || !cart.length || sending} onClick={() => { setError(''); setReviewOpen(true) }}>Revisar talão e ir ao WhatsApp<ArrowRight size={19}/></button></div></aside>

    {reviewOpen && <ShopvaxCheckoutReview items={cart} total={cartTotal} minimum={minimum} storeName={store?.name || ''} sellerName={seller?.name || 'atendimento'} sending={sending} error={error} onClose={() => { if (!sending) setReviewOpen(false) }} onSubmit={sendOrder}/>}
    {readyOrder && <ShopvaxOrderReady code={readyOrder.code} url={readyOrder.url} storeName={store?.name || ''} onClose={() => setReadyOrder(null)}/>} 
    {picker && <div className="picker-layer" role="dialog" aria-modal="true" aria-label={`Escolher ${picker.name}`}><button className="picker-layer__backdrop" onClick={() => setPicker(null)} aria-label="Fechar produto"/><section className="product-picker"><header className="svx-product-page__nav"><div><strong>{store?.name}</strong><small>{store?.eyebrow || 'Catálogo de atacado'}</small></div><button type="button" onClick={() => setPicker(null)}>Voltar à coleção <ArrowRight size={16}/></button></header><button className="product-picker__close" onClick={() => setPicker(null)} aria-label="Fechar"><X size={20}/></button><div className="product-picker__media product-gallery"><div className="product-gallery__stage">{picker.mediaType === 'video' && !pickerGallery.length ? <video src={picker.mediaUrl} controls playsInline/> : <ResilientImage src={pickerGallery[galleryIndex] || mediaUrl(picker)} alt={picker.name}/>} {pickerGallery.length > 1 && <><button className="product-gallery__prev" onClick={() => setGalleryIndex((i) => (i - 1 + pickerGallery.length) % pickerGallery.length)} aria-label="Foto anterior"><ChevronLeft size={20}/></button><button className="product-gallery__next" onClick={() => setGalleryIndex((i) => (i + 1) % pickerGallery.length)} aria-label="Próxima foto"><ChevronRight size={20}/></button></>}</div>{pickerGallery.length > 1 && <div className="product-gallery__thumbs">{pickerGallery.map((url, index) => <button key={url} className={index === galleryIndex ? 'is-active' : ''} onClick={() => setGalleryIndex(index)} aria-label={`Ver foto ${index + 1}`}><ResilientImage src={url} alt={`${picker.name} - foto ${index + 1}`}/></button>)}</div>}</div><div className="product-picker__body"><div className="product-picker__scroll"><div className="product-picker__meta"><span>{picker.sku}</span><span>{picker.category}</span></div><h2>{picker.name}</h2><p>{picker.description}</p><strong className="product-picker__price">{money.format(picker.price)}</strong>{getGradeGroups(picker) && <div className="svx-picker-modes" role="group" aria-label="Forma de comprar"><button type="button" aria-pressed={gradeMode} onClick={() => { setGradeMode(true); setError("") }}>Montar grade</button><button type="button" aria-pressed={!gradeMode} onClick={() => { setGradeMode(false); setError("") }}>Uma variação</button></div>}{gradeMode && getGradeGroups(picker) && <ProductGrade key={picker.id} product={picker} onAdd={addGradeLines} onError={setError}/>} {!gradeMode && picker.variations.map((group) => <div className="variant-group" key={group.name}><div><strong>{group.name}</strong><span>{pickerSelections[group.name] || 'Escolha uma opção'}</span></div><div className="variant-options">{group.options.map((option) => <button key={option} className={pickerSelections[group.name] === option ? 'is-active' : ''} onClick={() => { setPickerSelections((current) => ({...current, [group.name]: option})); setError('') }}>{option}</button>)}</div></div>)}{!gradeMode && <div className="picker-quantity"><div><strong>Quantidade</strong><span>{money.format(picker.price * pickerQty)}</span></div><div className="quantity-control quantity-control--large"><button onClick={() => setPickerQty((v) => Math.max(1, v - 1))} aria-label="Diminuir quantidade"><Minus size={16}/></button><b><span className="svx-motion-count" key={pickerQty}>{pickerQty}</span></b><button onClick={() => setPickerQty((v) => v + 1)} aria-label="Aumentar quantidade"><Plus size={16}/></button></div></div>}{error && <p className="form-error" role="alert">{error}</p>}</div>{!gradeMode && <div className="product-picker__footer"><button className="picker-add" onClick={confirmPicker}><ShoppingBag size={18}/><span className="picker-add__label">Adicionar {pickerQty} ao carrinho</span><strong className="picker-add__price">{money.format(picker.price * pickerQty)}</strong></button></div>}</div><section className="svx-product-page__related" aria-label="Leva junto"><div className="svx-product-page__related-head"><h3>Leva junto</h3><span>Peças da mesma loja · pedido em andamento</span></div><div className="svx-product-page__related-items">{products.filter((item) => item.id !== picker.id).slice(0,8).map((item) => <button type="button" key={item.id} onClick={() => openPicker(item)}><ResilientImage src={mediaUrl(item)} alt={item.name}/><span><strong>{item.name}</strong><small>{item.sku || 'REF.'} · {money.format(item.price)}</small></span></button>)}</div></section></section></div>}

    {feedNotice && <div className="svx-feed-notice" role="status">{feedNotice === 'NA GRADE' ? <span key={cartCount} className="svx-motion-toast-stamp">NA GRADE</span> : feedNotice}</div>}
    {view === 'store' && <button className="mobile-cart" onClick={() => setCartOpen(true)}><ShoppingBag size={18}/><span>{cartCount > 0 ? `${cartCount} itens · ${money.format(cartTotal)}` : 'Ver carrinho'}</span><ArrowLeft className="mobile-cart__arrow" size={17}/></button>}
  </div>
}
