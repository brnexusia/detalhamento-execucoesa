import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, Heart, MessageCircleQuestion, Minus, Play, Plus, Share2, ShoppingBag, Store, Volume2, VolumeX, X } from 'lucide-react'
import './social-feed.css'

type VariationGroup = { name: string; options: string[] }
type FeedProduct = {
  id: string
  sku: string
  name: string
  description: string
  price: number
  category: string
  mediaUrl: string
  mediaType: 'image' | 'video'
  pack?: string
  variations: VariationGroup[]
  featured?: boolean
  publishedAt: string
}
type SocialPost = {
  id: string
  product: FeedProduct
  store: { id: string; slug: string; name: string; logoUrl: string; accent: string; planTier: 'bronze' | 'prata' | 'ouro' }
  interactions: { views: number; likes: number; shares: number; followers: number; liked: boolean; following: boolean }
}
type FeedPayload = { posts: SocialPost[]; page: { hasMore: boolean; nextCursor: string | null } }
type FeedSession = { posts: SocialPost[]; cursor: string | null; hasMore: boolean; scrollTop: number; savedAt: number }
type FeedCartItem = { key: string; product: FeedProduct; quantity: number; selections: Record<string, string> }
type PickerState = { post: SocialPost; selections: Record<string, string>; quantity: number }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const feedSessionKey = 'shopvax_social_feed_state_v2'
const legacyFeedSessionKey = 'shopvax_social_feed_state_v1'
const feedSessionTtl = 30 * 60 * 1000

function compact(value: number) { return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0) }
function cartStorageKey(slug: string) { return `shopvax-cart-v1:${encodeURIComponent(slug)}` }
function profilePath(slug: string, productId?: string) {
  const base = `/perfil/${encodeURIComponent(slug)}`
  return productId ? `${base}?produto=${encodeURIComponent(productId)}` : base
}
function commercialStorePath(slug: string, sellerSlug?: string) {
  return sellerSlug ? `/${encodeURIComponent(slug)}/${encodeURIComponent(sellerSlug)}` : `/${encodeURIComponent(slug)}`
}
function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function readFeedSession(): FeedSession | null {
  try {
    const raw = sessionStorage.getItem(feedSessionKey) || sessionStorage.getItem(legacyFeedSessionKey) || 'null'
    const parsed = JSON.parse(raw) as (FeedSession & { scrollY?: number }) | null
    if (!parsed || !Array.isArray(parsed.posts) || Date.now() - Number(parsed.savedAt || 0) > feedSessionTtl) return null
    return { posts: parsed.posts, cursor: parsed.cursor || null, hasMore: parsed.hasMore !== false, scrollTop: Number(parsed.scrollTop ?? parsed.scrollY ?? 0), savedAt: Number(parsed.savedAt || Date.now()) }
  } catch { return null }
}

function saveFeedSession(posts: SocialPost[], cursor: string | null, hasMore: boolean, scrollTop: number) {
  try { sessionStorage.setItem(feedSessionKey, JSON.stringify({ posts, cursor, hasMore, scrollTop, savedAt: Date.now() } satisfies FeedSession)) }
  catch { /* sessão indisponível */ }
}

function readCart(slug: string): FeedCartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(cartStorageKey(slug)) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeCart(slug: string, items: FeedCartItem[]) {
  try { localStorage.setItem(cartStorageKey(slug), JSON.stringify(items)) }
  catch { /* armazenamento indisponível */ }
}

function cartItemKey(product: FeedProduct, selections: Record<string, string>) {
  return `${product.id}:${Object.entries(selections).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('|')}`
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true }
  } catch { /* usa fallback */ }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch { return false }
}

async function sellerSlugForStore(slug: string) {
  try {
    const response = await fetch(`/api/social/stores/${encodeURIComponent(slug)}/seller-route`, { credentials: 'include' })
    const body = await response.json().catch(() => null)
    return response.ok ? String(body?.seller?.slug || '') : ''
  } catch { return '' }
}

function SocialPostCard({ post, cartCount, onProfile, onAdd, onCart }: { post: SocialPost; cartCount: number; onProfile: (slug: string) => void; onAdd: (post: SocialPost) => void; onCart: (store: SocialPost['store']) => void }) {
  const cardRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const viewed = useRef(false)
  const [interactions, setInteractions] = useState(post.interactions)
  const [asking, setAsking] = useState(false)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const target = cardRef.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      const active = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .68)
      if (videoRef.current) {
        if (active) void videoRef.current.play().catch(() => undefined)
        else videoRef.current.pause()
      }
      if (viewed.current || !entry?.isIntersecting || entry.intersectionRatio < .58) return
      viewed.current = true
      fetch(`/api/social/posts/${post.id}/view`, { method: 'POST' })
        .then((response) => response.ok ? response.json() : null)
        .then((body) => { if (body) setInteractions((current) => ({ ...current, views: body.views })) })
        .catch(() => undefined)
    }, { threshold: [0, .58, .68, 1] })
    observer.observe(target)
    return () => { observer.disconnect(); videoRef.current?.pause() }
  }, [post.id])

  const like = async () => {
    const response = await fetch(`/api/social/posts/${post.id}/like`, { method: 'POST' })
    const body = await response.json().catch(() => null)
    if (response.ok && body) setInteractions((current) => ({ ...current, liked: body.liked, likes: body.likes }))
  }

  const share = async () => {
    const url = `${window.location.origin}${profilePath(post.store.slug, post.product.id)}`
    try {
      if (navigator.share) await navigator.share({ title: post.product.name, text: `${post.product.name} · ${post.store.name}`, url })
      else if (!(await copyText(url))) return
      const response = await fetch(`/api/social/posts/${post.id}/share`, { method: 'POST' })
      const body = await response.json().catch(() => null)
      if (response.ok && body) setInteractions((current) => ({ ...current, shares: body.shares }))
    } catch { /* compartilhamento cancelado */ }
  }

  const ask = async () => {
    if (asking) return
    setAsking(true)
    try {
      const response = await fetch(`/api/social/posts/${post.id}/ask`, { method: 'POST' })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.whatsappUrl) window.open(body.whatsappUrl, '_blank', 'noopener,noreferrer')
      else if (body?.error) window.alert(body.error)
    } finally { setAsking(false) }
  }

  return <article className="social-feed-card" ref={cardRef}>
    <div className="social-feed-media" onDoubleClick={() => { if (!interactions.liked) void like() }}>
      {post.product.mediaType === 'video'
        ? <video ref={videoRef} src={post.product.mediaUrl} loop muted={muted} playsInline preload="metadata" />
        : post.product.mediaUrl
          ? <img src={post.product.mediaUrl} alt={post.product.name} loading="lazy" decoding="async" />
          : <div className="social-feed-media__empty"><Play size={34}/></div>}
      <div className="social-feed-shade" />
      {post.product.mediaType === 'video' && <button className="social-feed-sound" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Ativar som' : 'Silenciar vídeo'}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>}
    </div>

    <button className="social-feed-store" onClick={() => onProfile(post.store.slug)}>
      <span className="social-feed-store__avatar">{post.store.logoUrl ? <img src={post.store.logoUrl} alt=""/> : <Store size={19}/>}</span>
      <span><strong>{post.store.name}</strong><small>@{post.store.slug}</small></span>
      <ChevronRight size={17}/>
    </button>

    <aside className="social-feed-actions" aria-label="Interações">
      <button aria-label={interactions.liked ? 'Descurtir produto' : 'Curtir produto'} className={interactions.liked ? 'is-active' : ''} onClick={like}><Heart size={25} fill={interactions.liked ? 'currentColor' : 'none'}/><span>{compact(interactions.likes)}</span></button>
      <div className="social-feed-actions__metric" aria-label={`${compact(interactions.views)} visualizações`}><Eye size={24}/><span>{compact(interactions.views)}</span></div>
      <button aria-label="Compartilhar produto" onClick={share}><Share2 size={24}/><span>{compact(interactions.shares)}</span></button>
      <button aria-label="Perguntar sobre o produto" className="social-feed-actions__ask" onClick={ask} disabled={asking}><MessageCircleQuestion size={25}/><span>{asking ? 'Abrindo…' : 'Perguntar'}</span></button>
    </aside>

    <div className="social-feed-copy">
      <span>{post.product.category}</span>
      <h2>{post.product.name}</h2>
      {post.product.description && <p>{post.product.description}</p>}
      <div className="social-feed-buyline">
        <strong>{money.format(post.product.price)}</strong>
        <div>
          <button className="social-feed-add" onClick={() => onAdd(post)}><Plus size={17}/> Adicionar</button>
          {cartCount > 0 && <button className="social-feed-cart" onClick={() => onCart(post.store)} aria-label={`Abrir carrinho da ${post.store.name}`}><ShoppingBag size={17}/><b>{cartCount}</b></button>}
        </div>
      </div>
    </div>
  </article>
}

export default function SocialFeed() {
  const restored = useRef<FeedSession | null>(readFeedSession())
  const listRef = useRef<HTMLElement | null>(null)
  const scrollTopRef = useRef(restored.current?.scrollTop || 0)
  const loadingRef = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [posts, setPosts] = useState<SocialPost[]>(() => restored.current?.posts || [])
  const [cursor, setCursor] = useState<string | null>(() => restored.current?.cursor || null)
  const [hasMore, setHasMore] = useState(() => restored.current?.hasMore ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [pickerError, setPickerError] = useState('')
  const [activeCart, setActiveCart] = useState<SocialPost['store'] | null>(null)
  const [cartVersion, setCartVersion] = useState(0)

  const persist = useCallback(() => saveFeedSession(posts, cursor, hasMore, listRef.current?.scrollTop ?? scrollTopRef.current), [posts, cursor, hasMore])

  const load = useCallback(async (nextCursor?: string | null) => {
    if (loadingRef.current || (!hasMore && nextCursor)) return
    loadingRef.current = true
    setLoading(true); setError('')
    try {
      const query = new URLSearchParams({ limit: '12' })
      if (nextCursor) query.set('cursor', nextCursor)
      const response = await fetch(`/api/social/feed?${query.toString()}`, { credentials: 'include' })
      const body = await response.json().catch(() => ({})) as FeedPayload & { error?: string }
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar o feed.')
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id))
        return nextCursor ? [...current, ...body.posts.filter((post) => !seen.has(post.id))] : body.posts
      })
      setCursor(body.page?.nextCursor || null)
      setHasMore(Boolean(body.page?.hasMore))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar o feed.') }
    finally { loadingRef.current = false; setLoading(false) }
  }, [hasMore])

  useEffect(() => {
    if (restored.current?.posts?.length) {
      const y = Number(restored.current.scrollTop || 0)
      requestAnimationFrame(() => requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = y }))
      restored.current = null
      return
    }
    void load(null)
  }, [load])

  useEffect(() => { saveFeedSession(posts, cursor, hasMore, scrollTopRef.current) }, [posts, cursor, hasMore])
  useEffect(() => {
    const save = () => persist()
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [persist])

  useEffect(() => {
    const target = sentinel.current
    const root = listRef.current
    if (!target || !root || !hasMore || loading) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting) && cursor) void load(cursor) }, { root, rootMargin: '800px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [cursor, hasMore, loading, load])

  const cartCount = (slug: string) => { void cartVersion; return readCart(slug).reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0) }

  const addCartItem = (post: SocialPost, selections: Record<string, string>, quantity: number) => {
    const items = readCart(post.store.slug)
    const key = cartItemKey(post.product, selections)
    const existing = items.find((item) => item.key === key)
    const next = existing
      ? items.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
      : [...items, { key, product: post.product, quantity, selections }]
    writeCart(post.store.slug, next)
    setCartVersion((value) => value + 1)
  }

  const requestAdd = (post: SocialPost) => {
    const groups = Array.isArray(post.product.variations) ? post.product.variations : []
    if (!groups.length) { addCartItem(post, {}, 1); return }
    const defaults: Record<string, string> = {}
    groups.forEach((group) => { if (group.options.length === 1) defaults[group.name] = group.options[0] })
    setPicker({ post, selections: defaults, quantity: 1 })
    setPickerError('')
  }

  const confirmPicker = () => {
    if (!picker) return
    const missing = picker.post.product.variations.find((group) => !picker.selections[group.name])
    if (missing) { setPickerError(`Escolha ${missing.name.toLowerCase()}.`); return }
    addCartItem(picker.post, picker.selections, picker.quantity)
    setPicker(null)
    setPickerError('')
  }

  const changeCartQuantity = (key: string, delta: number) => {
    if (!activeCart) return
    const next = readCart(activeCart.slug).map((item) => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0)
    writeCart(activeCart.slug, next)
    setCartVersion((value) => value + 1)
  }

  const openProfile = (slug: string) => { persist(); go(profilePath(slug)) }
  const openCommercialStore = async (slug: string) => { persist(); const seller = await sellerSlugForStore(slug); go(commercialStorePath(slug, seller)) }
  const cartItems = activeCart ? readCart(activeCart.slug) : []
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.product.price || 0) * Number(item.quantity || 0), 0)

  return <div className="social-feed-page">
    <header className="social-feed-nav"><strong>SHOPVAX</strong><span>Descobrir</span><a href="/entrar">Entrar</a></header>
    <main className="social-feed-list" ref={listRef} onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}>
      {posts.map((post) => <SocialPostCard post={post} key={post.id} cartCount={cartCount(post.store.slug)} onProfile={openProfile} onAdd={requestAdd} onCart={setActiveCart}/>) }
      {!posts.length && !loading && !error && <div className="social-feed-state"><h1>O feed está começando.</h1><p>As publicações das lojas aparecerão aqui.</p></div>}
      {error && <div className="social-feed-state"><p>{error}</p><button onClick={() => void load(cursor)}>Tentar novamente</button></div>}
      {loading && <div className="social-feed-loading">Carregando produtos…</div>}
      <div ref={sentinel} className="social-feed-sentinel" />
    </main>

    {picker && <div className="feed-sheet-layer">
      <button className="feed-sheet-backdrop" onClick={() => setPicker(null)} aria-label="Fechar seleção"/>
      <section className="feed-sheet feed-picker-sheet">
        <header><div><span>{picker.post.store.name}</span><h2>{picker.post.product.name}</h2></div><button onClick={() => setPicker(null)}><X size={20}/></button></header>
        <div className="feed-sheet-body">
          {picker.post.product.variations.map((group) => <div className="feed-variant" key={group.name}><strong>{group.name}</strong><div>{group.options.map((option) => <button key={option} className={picker.selections[group.name] === option ? 'is-active' : ''} onClick={() => { setPicker((current) => current ? { ...current, selections: { ...current.selections, [group.name]: option } } : current); setPickerError('') }}>{option}</button>)}</div></div>)}
          <div className="feed-picker-qty"><span>Quantidade</span><div><button onClick={() => setPicker((current) => current ? { ...current, quantity: Math.max(1, current.quantity - 1) } : current)}><Minus size={15}/></button><b>{picker.quantity}</b><button onClick={() => setPicker((current) => current ? { ...current, quantity: current.quantity + 1 } : current)}><Plus size={15}/></button></div></div>
          {pickerError && <p className="feed-sheet-error">{pickerError}</p>}
        </div>
        <footer><strong>{money.format(picker.post.product.price * picker.quantity)}</strong><button onClick={confirmPicker}><ShoppingBag size={17}/> Adicionar ao carrinho</button></footer>
      </section>
    </div>}

    {activeCart && <div className="feed-sheet-layer">
      <button className="feed-sheet-backdrop" onClick={() => setActiveCart(null)} aria-label="Fechar carrinho"/>
      <section className="feed-sheet feed-cart-sheet">
        <header><div><span>Carrinho</span><h2>{activeCart.name}</h2></div><button onClick={() => setActiveCart(null)}><X size={20}/></button></header>
        <div className="feed-sheet-body">
          {cartItems.length ? cartItems.map((item) => <article className="feed-cart-item" key={item.key}>
            <div className="feed-cart-thumb">{item.product.mediaType === 'image' && item.product.mediaUrl ? <img src={item.product.mediaUrl} alt=""/> : <Play size={18}/>}</div>
            <div><strong>{item.product.name}</strong><small>{Object.entries(item.selections).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Sem variação'}</small><span>{money.format(item.product.price)}</span></div>
            <div className="feed-cart-qty"><button onClick={() => changeCartQuantity(item.key, -1)}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => changeCartQuantity(item.key, 1)}><Plus size={14}/></button></div>
          </article>) : <div className="feed-cart-empty">Seu carrinho desta loja está vazio.</div>}
        </div>
        <footer><strong>{money.format(cartTotal)}</strong><button disabled={!cartItems.length} onClick={() => void openCommercialStore(activeCart.slug)}>Ir para a loja finalizar <ChevronRight size={17}/></button></footer>
      </section>
    </div>}
  </div>
}
