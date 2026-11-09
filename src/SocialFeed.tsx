import ShopvaxLoading from './ShopvaxLoading'
import SocialAccountChoice from './SocialAccountChoice'
import { socialCartCount } from './social-cart'
const SocialShopping = lazy(() => import('./SocialShopping'))
import { useOwnerSession } from './owner-session'
import { useBuyerSession } from './buyer-session'
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { showToast } from './ui-dialogs'
import { Eye, Heart, MessageCircleQuestion, Play, Plus, Share2, ShoppingBag, Store, Volume2, VolumeX } from 'lucide-react'
import './social-feed.css'
import './shopvax-social-official.css'
import './shopvax-social-feed-layout.css'
import { shopvaxAccentTextColor } from './ShopvaxDesignSystem'
import { responsiveLocalMedia } from './responsive-media'

type VariationGroup = { name: string; options: string[] }
type FeedProduct = {
  id: string
  sku: string
  name: string
  description: string
  price: number | null
  category: string
  mediaUrl: string
  mediaType: 'image' | 'video'
  images?: string[]
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
type FeedSession = { posts: SocialPost[]; cursor: string | null; hasMore: boolean; scrollTop: number; savedAt: number; activePostId?: string }
const feedSessionKey = 'shopvax_social_feed_state_v3'
const feedSessionTtl = 5 * 60 * 1000
const maxFeedSessionPosts = 320
const maxFeedSessionBytes = 750_000
const renderNeighbors = 2

function compact(value: number) { return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0) }
function profilePath(slug: string, productId?: string) {
  const base = `/perfil/${encodeURIComponent(slug)}`
  return productId ? `${base}?produto=${encodeURIComponent(productId)}` : base
}
function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function isFeedRoute() { return ['/', '/feed', '/descobrir'].includes(window.location.pathname) }

function readFeedSession(): FeedSession | null {
  try {
    const raw = sessionStorage.getItem(feedSessionKey) || 'null'
    const parsed = JSON.parse(raw) as (FeedSession & { scrollY?: number }) | null
    if (!parsed || !Array.isArray(parsed.posts) || Date.now() - Number(parsed.savedAt || 0) > feedSessionTtl) return null
    return { posts: parsed.posts, cursor: parsed.cursor || null, hasMore: parsed.hasMore !== false, scrollTop: Number(parsed.scrollTop ?? parsed.scrollY ?? 0), activePostId: parsed.activePostId, savedAt: Number(parsed.savedAt || Date.now()) }
  } catch { return null }
}

function saveFeedSession(posts: SocialPost[], cursor: string | null, hasMore: boolean, scrollTop: number, viewportHeight: number) {
  const height = Math.max(1, viewportHeight)
  const index = Math.min(Math.max(0, Math.round(scrollTop / height)), Math.max(0, posts.length - 1))
  const first = posts.length <= maxFeedSessionPosts ? 0 : Math.max(0, index - 12)
  const cached = posts.slice(first, first + maxFeedSessionPosts)
  let relativeTop = Math.max(0, scrollTop - first * height)
  try {
    let snapshot = JSON.stringify({ posts: cached, cursor, hasMore, scrollTop: relativeTop, activePostId: posts[index]?.id, savedAt: Date.now() } satisfies FeedSession)
    while (snapshot.length > maxFeedSessionBytes && cached.length > 3) {
      if (relativeTop >= height * 2) { cached.shift(); relativeTop = Math.max(0, relativeTop - height) }
      else cached.pop()
      snapshot = JSON.stringify({ posts: cached, cursor, hasMore, scrollTop: relativeTop, activePostId: posts[index]?.id, savedAt: Date.now() } satisfies FeedSession)
    }
    if (snapshot.length <= maxFeedSessionBytes) sessionStorage.setItem(feedSessionKey, snapshot)
  } catch { /* cache opcional indisponível; carrinho permanece independente */ }
}

function productMediaCandidates(product: FeedProduct) {
  return Array.from(new Set([product.mediaUrl, ...(Array.isArray(product.images) ? product.images : [])].map((value) => String(value || '').trim()).filter(Boolean)))
}

function FeedImage({ product, className = '', priority = false }: { product: FeedProduct; className?: string; priority?: boolean }) {
  const candidates = productMediaCandidates(product)
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [product.id, product.mediaUrl, JSON.stringify(product.images || [])])
  const src = candidates[index] || ''
  if (!src) return <div className={className}><Play size={34}/></div>
  return <img className={className} src={src} srcSet={responsiveLocalMedia(src)} sizes="(max-width: 768px) 100vw, 560px" alt={product.name} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onError={() => setIndex((current) => current + 1)} />
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

const SocialPostCard = memo(function SocialPostCard({ post, cartCount, active, saveData, onProfile, onAdd, onCart, onFollow }: { post: SocialPost; cartCount: number; active: boolean; saveData: boolean; onProfile: (slug: string) => void; onAdd: (post: SocialPost) => void; onCart: (store: SocialPost['store']) => void; onFollow: (post: SocialPost) => void }) {
  const cardRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const viewed = useRef(false)
  const liking = useRef(false)
  const [interactions, setInteractions] = useState(post.interactions)
  useEffect(() => {
    setInteractions((current) => ({ ...current, following: post.interactions.following, followers: post.interactions.followers }))
  }, [post.interactions.following, post.interactions.followers])
  const [asking, setAsking] = useState(false)
  const [muted, setMuted] = useState(true)
  const descriptionRef = useRef<HTMLParagraphElement | null>(null)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false)

  useEffect(() => {
    setDescriptionExpanded(false)
  }, [post.id])

  useEffect(() => {
    if (descriptionExpanded) return
    const description = descriptionRef.current
    if (!description) { setDescriptionCanExpand(false); return }
    const measure = () => setDescriptionCanExpand(description.scrollHeight > description.clientHeight + 1)
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(description)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [post.product.description, descriptionExpanded])

  useEffect(() => {
    const target = cardRef.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      const active = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .68)
      if (videoRef.current) {
        if (active && !saveData) void videoRef.current.play().catch(() => undefined)
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
  }, [post.id, active, saveData])

  const like = async () => {
    if (liking.current) return
    liking.current = true
    const previous = { liked: interactions.liked, likes: interactions.likes }
    // Reversible optimistic UI only for likes (never for payments or stock).
    setInteractions((current) => ({
      ...current,
      liked: !current.liked,
      likes: Math.max(0, current.likes + (current.liked ? -1 : 1)),
    }))
    try {
      const response = await fetch(`/api/social/posts/${post.id}/like`, { method: 'POST' })
      const body = await response.json().catch(() => null)
      if (!response.ok || typeof body?.liked !== 'boolean' || !Number.isFinite(Number(body?.likes))) throw new Error('like-unconfirmed')
      setInteractions((current) => ({ ...current, liked: body.liked, likes: Number(body.likes) }))
    } catch {
      setInteractions((current) => ({ ...current, ...previous }))
      showToast('Não foi possível atualizar a curtida. Tente novamente.', 'error')
    } finally {
      liking.current = false
    }
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
      if (response.status===401) onAdd(post)
      else if (response.ok && body?.whatsappUrl) window.open(body.whatsappUrl, '_blank', 'noopener,noreferrer')
      else if (body?.error) showToast(body.error, 'error')
    } finally { setAsking(false) }
  }

  return <article className="social-feed-card" data-post-id={post.id} ref={cardRef}
    style={{ '--social-store-accent': post.store.accent || '#F25C05', '--social-store-text': shopvaxAccentTextColor(post.store.accent || '#F25C05') } as React.CSSProperties}>
    <div className="social-feed-media" onDoubleClick={() => { if (!interactions.liked) void like() }}>
      {post.product.mediaType === 'video'
        ? <video ref={videoRef} src={active ? post.product.mediaUrl : undefined} poster={post.product.images?.[0] || undefined} loop muted={muted} playsInline preload={active && !saveData ? 'metadata' : 'none'} />
        : productMediaCandidates(post.product).length
          ? <FeedImage product={post.product} priority={active} />
          : <div className="social-feed-media__empty"><Play size={34}/></div>}
      <div className="social-feed-shade" />
      {post.product.mediaType === 'video' && saveData && active && <button className="social-feed-play" type="button" onClick={() => { void videoRef.current?.play().catch(() => undefined) }}>Reproduzir vídeo</button>}
       {post.product.mediaType === 'video' && <button className="social-feed-sound" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Ativar som' : 'Silenciar vídeo'}>{muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}</button>}
    </div>

    <aside className="social-feed-actions" aria-label="Interações">
      <button type="button" className="social-feed-store" aria-label={`Ver perfil da loja ${post.store.name}`} title={`Ver perfil de ${post.store.name}`} onClick={() => onProfile(post.store.slug)}>
        <span className="social-feed-store__avatar">{post.store.logoUrl ? <img src={post.store.logoUrl} alt=""/> : <Store size={19}/>}</span>
      </button>
      <button aria-label={interactions.liked ? 'Descurtir produto' : 'Curtir produto'} className={interactions.liked ? 'is-active' : ''} onClick={like}><Heart size={25} fill={interactions.liked ? 'currentColor' : 'none'}/><span>{compact(interactions.likes)}</span></button>
      <div className="social-feed-actions__metric" aria-label={`${compact(interactions.views)} visualizações`}><Eye size={24}/><span>{compact(interactions.views)}</span></div>
      <button aria-label="Compartilhar produto" onClick={share}><Share2 size={24}/><span>{compact(interactions.shares)}</span></button>
      <button aria-label="Perguntar sobre o produto" className="social-feed-actions__ask" onClick={ask} disabled={asking}><MessageCircleQuestion size={25}/><span>{asking ? 'Abrindo…' : 'Perguntar'}</span></button>
    </aside>

    <div className="social-feed-copy">
      <span>{post.product.category}</span>
      <h2>{post.product.name}</h2>
      <button type="button" className="social-feed-follow" onClick={() => onFollow(post)} aria-label={`Seguir ${post.store.name}`}>
        {interactions.following ? 'Seguindo' : 'Seguir'} · {post.store.name}
      </button>
      {post.product.description && <div className={`social-feed-description ${descriptionExpanded ? 'is-expanded' : ''}`}>
        <p
          ref={descriptionRef}
          onClick={() => { if (descriptionCanExpand && !descriptionExpanded) setDescriptionExpanded(true) }}
          title={descriptionCanExpand && !descriptionExpanded ? 'Clique para ler a descrição completa' : undefined}
        >{post.product.description}</p>
        {descriptionCanExpand && <button type="button" aria-expanded={descriptionExpanded} onClick={() => setDescriptionExpanded((value) => !value)}>{descriptionExpanded ? 'Menos' : 'Mais'}</button>}
      </div>}
      <div className="social-feed-buyline">
        <strong>Ver valores e condições</strong>
        <div>
          <button className="social-feed-add" onClick={() => onAdd(post)}><Plus size={17}/> Ver preço / Comprar</button>
          {cartCount > 0 && <button className="social-feed-cart" onClick={() => onCart(post.store)} aria-label={`Abrir carrinho da ${post.store.name}`}><ShoppingBag size={17}/><b>{cartCount}</b></button>}
        </div>
      </div>
    </div>
  </article>
})

export default function SocialFeed() {
  // Lazy initializer: parsing a 320-post session on every swipe is expensive.
  const [initialSession] = useState(readFeedSession)
  const restored = useRef<FeedSession | null>(initialSession)
  const restoredIndex = useRef((() => {
    const cached = restored.current
    if (!cached?.posts.length) return 0
    const previous = window.history.state?.shopvaxFeedPosition as { postId?: string; index?: number } | undefined
    const anchor = previous?.postId || cached.activePostId
    const matching = anchor ? cached.posts.findIndex((post) => post.id === anchor) : -1
    if (matching >= 0) return matching
    const estimated = previous?.index ?? Math.round(cached.scrollTop / Math.max(1, window.innerHeight))
    return Math.max(0, Math.min(cached.posts.length - 1, estimated))
  })())
  const restorationPendingRef = useRef(Boolean(restored.current?.posts.length))
  const routeResumesRef = useRef(0)
  const restoredAnchorLockRef = useRef(Boolean(restored.current?.posts.length))
  const listRef = useRef<HTMLElement | null>(null)
  const scrollTopRef = useRef(restored.current?.scrollTop || 0)
  const loadingRef = useRef(false)
  const initialLoadStarted = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [posts, setPosts] = useState<SocialPost[]>(() => restored.current?.posts || [])
  const [cursor, setCursor] = useState<string | null>(() => restored.current?.cursor || null)
  const [hasMore, setHasMore] = useState(() => restored.current?.hasMore ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountChoice, setAccountChoice] = useState<{reason:'login'|'follow'; storeSlug?:string; storeId?:string} | null>(null)
  const [socialPurchase,setSocialPurchase] = useState<{storeSlug:string;storeName:string;productId?:string;initialCart?:boolean}|null>(null)
  const ownerSession = useOwnerSession()
  const buyerSession = useBuyerSession()
  const [cartVersion, setCartVersion] = useState(0)
  const [activeIndex, setActiveIndex] = useState(() => restoredIndex.current)
  const [restoreEpoch, setRestoreEpoch] = useState(0)
  const saveData = useMemo(() => { const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection; return Boolean(connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType || '') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) }, [])

  const persist = useCallback(() => {
    const list = listRef.current
    const height = list?.clientHeight || window.innerHeight
    const scrollTop = (restorationPendingRef.current || restoredAnchorLockRef.current) ? restoredIndex.current * height : (list?.scrollTop ?? scrollTopRef.current)
    const index = Math.max(0, Math.min(posts.length - 1, Math.round(scrollTop / Math.max(1, height))))
    saveFeedSession(posts, cursor, hasMore, scrollTop, height)
    // History entry belongs to the feed, not the profile opened by pushState.
    // Keep an identity anchor so a viewport resize cannot turn item 200 into item 3.
    const state = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    window.history.replaceState({ ...state, shopvaxFeedPosition: { postId: posts[index]?.id, index } }, '')
  }, [posts, cursor, hasMore])

  const load = useCallback(async (nextCursor?: string | null) => {
    if (loadingRef.current || (!hasMore && nextCursor)) return
    loadingRef.current = true
    setLoading(true); setError('')
    try {
      const query = new URLSearchParams({ limit: '12' })
      if (nextCursor) query.set('cursor', nextCursor)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try { response = await fetch(`/api/social/feed?${query.toString()}`, { credentials: 'include', signal: controller.signal }) }
      finally { window.clearTimeout(timeout) }
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

  // Restore *before paint* from the publication identity and the actual container height.
  // React's scroll events during mount/virtualization must not overwrite the saved index.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !restorationPendingRef.current) return
    const previousAnchor = list.style.overflowAnchor
    // Snap is disabled by JSX from the first DOM commit, not after first paint.
    list.style.scrollSnapType = 'none'
    list.style.overflowAnchor = 'none'
    let firstFrame = 0
    let secondFrame = 0
    const restore = () => {
      if (!list.isConnected || list.clientHeight <= 0) return false
      const position = restoredIndex.current * list.clientHeight
      list.scrollTop = position
      scrollTopRef.current = position
      return true
    }
    restore()
    let attempts = 0
    const waitForVisibleLayout = () => {
      if (!list.isConnected) return
      if (!restore()) {
        if (++attempts < 120) firstFrame = window.requestAnimationFrame(waitForVisibleLayout)
        return
      }
      secondFrame = window.requestAnimationFrame(() => {
        restore()
        // Only release the restoration lock when the identity-aligned offset is stable.
        // The CSS snap targets may otherwise pull the scroll back to an old mounted card.
        restore()
        list.style.scrollSnapType = ''
        window.requestAnimationFrame(() => {
          const wanted = restoredIndex.current * Math.max(1, list.clientHeight)
          if (Math.abs(list.scrollTop - wanted) > 2) {
            list.style.scrollSnapType = 'none'
            restore()
            list.style.scrollSnapType = ''
          }
          restorationPendingRef.current = false
          list.style.overflowAnchor = previousAnchor
        })
      })
    }
    firstFrame = window.requestAnimationFrame(waitForVisibleLayout)
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      list.style.scrollSnapType = ''
      list.style.overflowAnchor = previousAnchor
    }
  }, [restoreEpoch])

  // React 19 Suspense can hide/reveal the same mounted feed when switching
  // /feed <-> /perfil. Rehydrate on history return and on effect re-attachment,
  // not only in the component's first-mount initializer.
  useEffect(() => {
    let wasFeed = isFeedRoute()
    const resumeFromProfile = () => {
      if (!isFeedRoute()) { wasFeed = false; return }
      const anchor = window.history.state?.shopvaxFeedPosition as { postId?: string; index?: number } | undefined
      if ((!anchor && wasFeed) || restorationPendingRef.current) { wasFeed = true; return }
      wasFeed = true
      const cached = readFeedSession()
      if (!cached?.posts?.length) return
      const indexById = cached.posts.findIndex((post) => post.id === (anchor?.postId || cached.activePostId))
      const index = indexById >= 0 ? indexById : Math.min(cached.posts.length - 1,
        Math.max(0, anchor?.index ?? Math.round(cached.scrollTop / Math.max(1, window.innerHeight))))
      restoredIndex.current = index
      routeResumesRef.current += 1
      restorationPendingRef.current = true
      restoredAnchorLockRef.current = true
      scrollTopRef.current = index * Math.max(1, listRef.current?.clientHeight || window.innerHeight)
      setPosts(cached.posts)
      setCursor(cached.cursor)
      setHasMore(cached.hasMore)
      setActiveIndex(index)
      setRestoreEpoch((value) => value + 1)
    }
    window.addEventListener('popstate', resumeFromProfile)
    if (isFeedRoute() && window.history.state?.shopvaxFeedPosition) resumeFromProfile()
    return () => window.removeEventListener('popstate', resumeFromProfile)
  }, [])

  useEffect(() => {
    if (initialLoadStarted.current) return
    initialLoadStarted.current = true
    const cached = restored.current
    restored.current = null
    if (!cached?.posts?.length) void load(null)
  }, [load])

  // Cache is written on explicit navigation and pagehide, never from a mount effect.
  // A mount-time write can replace a correct deep-link anchor with browser scrollTop=0.
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

  useEffect(() => {
    const syncCart = () => setCartVersion((value) => value + 1)
    const onChange = (event: Event) => { if ((event as CustomEvent<{ storeSlug?: string }>).detail?.storeSlug) syncCart() }
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith('shopvax-social-cart-v1:') || event.key === null) syncCart() }
    window.addEventListener('shopvax:cart-change', onChange)
    window.addEventListener('shopvax:social-cart-change', onChange)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', syncCart)
    return () => { window.removeEventListener('shopvax:cart-change', onChange); window.removeEventListener('shopvax:social-cart-change', onChange); window.removeEventListener('storage', onStorage); window.removeEventListener('focus', syncCart) }
  }, [])
  const cartCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const post of posts) {
      if (counts.has(post.store.slug)) continue
      counts.set(post.store.slug, socialCartCount(post.store.slug))
    }
    return counts
  }, [posts, cartVersion])
  const cartCount = (slug: string) => cartCounts.get(slug) || 0
  const visibleIndex = Math.min(activeIndex, Math.max(0, posts.length - 1))
  const windowStart = Math.max(0, visibleIndex - renderNeighbors)
  const windowEnd = Math.min(posts.length, visibleIndex + renderNeighbors + 2)
  const visiblePosts = posts.slice(windowStart, windowEnd)

  const requestAdd = useCallback((post: SocialPost) => {
    setSocialPurchase({storeSlug:post.store.slug,storeName:post.store.name,productId:post.product.id})
  }, [])

  const openProfile = useCallback((slug: string) => { persist(); go(profilePath(slug)) }, [persist])
  const requestFollow = useCallback((post: SocialPost) => {
    persist()
    setAccountChoice({ reason: 'follow', storeSlug: post.store.slug, storeId: post.store.id })
  }, [persist])
  const updateFollow = useCallback((storeId: string, result: {following:boolean;followers:number}) => {
    setPosts((current) => current.map((post) =>
      post.store.id === storeId
        ? { ...post, interactions: { ...post.interactions, following: result.following, followers: result.followers } }
        : post))
  }, [])
  const releaseRestoredAnchor = () => { restoredAnchorLockRef.current = false }
  const repairRestoredAnchor = (list: HTMLElement) => {
    const desired = restoredIndex.current * Math.max(1, list.clientHeight)
    if (Math.abs(list.scrollTop - desired) <= 2) return
    list.style.scrollSnapType = 'none'
    list.scrollTop = desired
    scrollTopRef.current = desired
    window.requestAnimationFrame(() => { if (list.isConnected) list.style.scrollSnapType = '' })
  }

  return <div className="social-feed-page">
    <header className="social-feed-nav"><strong className="svx-social-brand"><img src="/brand/shopvax-symbol-dark.svg" className="svx-brand-symbol" alt="" aria-hidden="true" /><img src="/brand/shopvax-wordmark-light.svg" className="svx-brand-wordmark" alt="Shopvax" /></strong><span>PRODUTOS DAS LOJAS</span><div className="social-feed-nav__right"><a href="/para-lojas">Para lojas</a><button type="button" onClick={() => ownerSession === 'authenticated'
      ? go('/painel')
      : buyerSession === 'authenticated'
        ? go('/comprador')
        : setAccountChoice({reason:'login',storeSlug:posts[activeIndex]?.store.slug || posts[0]?.store.slug})}>{ownerSession === 'authenticated' ? 'Minha loja' : buyerSession === 'authenticated' ? 'Minha conta' : 'Entrar'}</button></div></header>
    <main className="social-feed-list" ref={listRef}
      data-feed-initial-posts={initialSession?.posts.length || 0}
      data-feed-restored-index={restoredIndex.current}
      data-feed-route-resumes={routeResumesRef.current}
      data-feed-active-index={activeIndex}
      data-feed-locked={restoredAnchorLockRef.current ? 'yes' : 'no'}
      style={restorationPendingRef.current ? { scrollSnapType: 'none' } : undefined}
      onTouchStart={releaseRestoredAnchor} onPointerDown={releaseRestoredAnchor}
      onWheel={releaseRestoredAnchor} onKeyDown={releaseRestoredAnchor}
      onScroll={(event) => {
        if (restorationPendingRef.current) return
        const list = event.currentTarget
        if (restoredAnchorLockRef.current) { repairRestoredAnchor(list); list.dataset.feedScrollEvent = 'repair'; return }
        list.dataset.feedScrollEvent = 'unlocked'
        scrollTopRef.current = event.currentTarget.scrollTop
        setActiveIndex((index) => {
          const next = Math.max(0, Math.min(posts.length - 1, Math.round(list.scrollTop / Math.max(1, list.clientHeight))))
          return next === index ? index : next
        })
      }}>
      {windowStart > 0 && <div className="social-feed-spacer" aria-hidden="true" style={{ height: `${windowStart * 100}dvh` }}/>}
      {visiblePosts.map((post, index) => <SocialPostCard post={post} key={post.id} active={windowStart + index === visibleIndex} saveData={saveData} cartCount={cartCount(post.store.slug)} onProfile={openProfile} onAdd={requestAdd} onCart={(store)=>setSocialPurchase({storeSlug:store.slug,storeName:store.name,initialCart:true})} onFollow={requestFollow}/>)}
      {windowEnd < posts.length && <div className="social-feed-spacer" aria-hidden="true" style={{ height: `${(posts.length - windowEnd) * 100}dvh` }}/>}
      {!posts.length && !loading && !error && <div className="social-feed-state"><h1>O feed está começando.</h1><p>As publicações das lojas aparecerão aqui.</p></div>}
      {error && <div className="social-feed-state"><p>{error}</p><button onClick={() => void load(cursor)}>Tentar novamente</button></div>}
      {loading && (!posts.length ? <ShopvaxLoading compact label="Carregando produtos…" /> : <div className="social-feed-loading">Carregando mais produtos…</div>)}
      <div ref={sentinel} className="social-feed-sentinel" />
    </main>

    {socialPurchase&&<Suspense fallback={<ShopvaxLoading compact label="Abrindo compra…"/>}><SocialShopping key={socialPurchase.storeSlug+':'+(socialPurchase.productId||'cart')} {...socialPurchase} onClose={()=>setSocialPurchase(null)} onCartChanged={()=>setCartVersion(v=>v+1)}/></Suspense>}
    {accountChoice && <SocialAccountChoice storeSlug={accountChoice.storeSlug} storeId={accountChoice.storeId} reason={accountChoice.reason}
      onFollowed={(result) => { if (accountChoice.storeId) updateFollow(accountChoice.storeId,result) }}
      onClose={() => setAccountChoice(null)}/>} 

  </div>
}
