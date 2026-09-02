import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, Heart, MessageCircleQuestion, Play, Share2, Store } from 'lucide-react'
import './social-feed.css'

type SocialPost = {
  id: string
  product: { id: string; sku: string; name: string; description: string; price: number; category: string; mediaUrl: string; mediaType: 'image' | 'video'; publishedAt: string }
  store: { id: string; slug: string; name: string; logoUrl: string; accent: string; planTier: 'bronze' | 'prata' | 'ouro' }
  interactions: { views: number; likes: number; shares: number; followers: number; liked: boolean; following: boolean }
}

type FeedPayload = { posts: SocialPost[]; page: { hasMore: boolean; nextCursor: string | null } }
type FeedSession = { posts: SocialPost[]; cursor: string | null; hasMore: boolean; scrollY: number; savedAt: number }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const feedSessionKey = 'shopvax_social_feed_state_v1'
const feedSessionTtl = 30 * 60 * 1000

function compact(value: number) { return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0) }

function readFeedSession(): FeedSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(feedSessionKey) || 'null') as FeedSession | null
    if (!parsed || !Array.isArray(parsed.posts) || Date.now() - Number(parsed.savedAt || 0) > feedSessionTtl) return null
    return parsed
  } catch { return null }
}

function persistFeedScroll() {
  try {
    const parsed = readFeedSession()
    if (!parsed) return
    sessionStorage.setItem(feedSessionKey, JSON.stringify({ ...parsed, scrollY: window.scrollY, savedAt: Date.now() }))
  } catch { /* sessão indisponível */ }
}

function storePath(slug: string, productId?: string, sellerSlug?: string) {
  const base = sellerSlug ? `/${encodeURIComponent(slug)}/${encodeURIComponent(sellerSlug)}` : `/${encodeURIComponent(slug)}`
  return productId ? `${base}?produto=${encodeURIComponent(productId)}` : base
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
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

async function openStore(slug: string, productId?: string) {
  persistFeedScroll()
  const sellerSlug = await sellerSlugForStore(slug)
  window.history.pushState({}, '', storePath(slug, productId, sellerSlug))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function SocialPostCard({ post }: { post: SocialPost }) {
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
      const active = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .62)
      if (videoRef.current) {
        if (active) void videoRef.current.play().catch(() => undefined)
        else videoRef.current.pause()
      }
      if (viewed.current || !entry?.isIntersecting || entry.intersectionRatio < .55) return
      viewed.current = true
      fetch(`/api/social/posts/${post.id}/view`, { method: 'POST' })
        .then((response) => response.ok ? response.json() : null)
        .then((body) => { if (body) setInteractions((current) => ({ ...current, views: body.views })) })
        .catch(() => undefined)
    }, { threshold: [0, .55, .62, 1] })
    observer.observe(target)
    return () => {
      observer.disconnect()
      videoRef.current?.pause()
    }
  }, [post.id])

  const like = async () => {
    const response = await fetch(`/api/social/posts/${post.id}/like`, { method: 'POST' })
    const body = await response.json().catch(() => null)
    if (response.ok && body) setInteractions((current) => ({ ...current, liked: body.liked, likes: body.likes }))
  }

  const likeFromGesture = () => {
    if (!interactions.liked) void like()
  }

  const share = async () => {
    const url = `${window.location.origin}${storePath(post.store.slug, post.product.id)}`
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
    <div className="social-feed-media" onDoubleClick={likeFromGesture}>
      {post.product.mediaType === 'video'
        ? <video ref={videoRef} src={post.product.mediaUrl} loop muted={muted} playsInline preload="metadata" onClick={() => setMuted((value) => !value)} />
        : post.product.mediaUrl
          ? <img src={post.product.mediaUrl} alt={post.product.name} loading="lazy" decoding="async" />
          : <div className="social-feed-media__empty"><Play size={34}/></div>}
      <div className="social-feed-shade" />
    </div>
    <button className="social-feed-store" onClick={() => void openStore(post.store.slug)}>
      <span className="social-feed-store__avatar">{post.store.logoUrl ? <img src={post.store.logoUrl} alt=""/> : <Store size={20}/>}</span>
      <span><strong>{post.store.name}</strong><small>@{post.store.slug}</small></span>
      <ChevronRight size={18}/>
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
      <div><strong>{money.format(post.product.price)}</strong><button onClick={() => void openStore(post.store.slug, post.product.id)}>Ver na loja <ChevronRight size={17}/></button></div>
    </div>
  </article>
}

export default function SocialFeed() {
  const restored = useRef<FeedSession | null>(readFeedSession())
  const [posts, setPosts] = useState<SocialPost[]>(() => restored.current?.posts || [])
  const [cursor, setCursor] = useState<string | null>(() => restored.current?.cursor || null)
  const [hasMore, setHasMore] = useState(() => restored.current?.hasMore ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sentinel = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)

  const load = useCallback(async (nextCursor?: string | null) => {
    if (loadingRef.current || (!hasMore && nextCursor)) return
    loadingRef.current = true
    setLoading(true); setError('')
    try {
      const query = new URLSearchParams({ limit: '12' })
      if (nextCursor) query.set('cursor', nextCursor)
      const response = await fetch(`/api/social/feed?${query.toString()}`)
      const body = await response.json().catch(() => ({})) as FeedPayload & { error?: string }
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar o feed.')
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id))
        return nextCursor ? [...current, ...body.posts.filter((post) => !seen.has(post.id))] : body.posts
      })
      setCursor(body.page?.nextCursor || null); setHasMore(Boolean(body.page?.hasMore))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar o feed.') }
    finally { loadingRef.current = false; setLoading(false) }
  }, [hasMore])

  useEffect(() => {
    if (restored.current?.posts?.length) {
      const y = Number(restored.current.scrollY || 0)
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' })))
      restored.current = null
      return
    }
    void load(null)
  }, [load])

  useEffect(() => {
    try {
      sessionStorage.setItem(feedSessionKey, JSON.stringify({ posts, cursor, hasMore, scrollY: window.scrollY, savedAt: Date.now() } satisfies FeedSession))
    } catch { /* sessão indisponível */ }
  }, [posts, cursor, hasMore])

  useEffect(() => {
    const save = () => persistFeedScroll()
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])

  useEffect(() => {
    const target = sentinel.current
    if (!target || !hasMore || loading) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting) && cursor) void load(cursor) }, { rootMargin: '900px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [cursor, hasMore, loading, load])

  return <div className="social-feed-page">
    <header className="social-feed-nav"><strong>SHOPVAX</strong><span>Descobrir</span><a href="/entrar">Entrar</a></header>
    <main className="social-feed-list">
      {posts.map((post) => <SocialPostCard post={post} key={post.id}/>) }
      {!posts.length && !loading && !error && <div className="social-feed-state"><h1>O feed está começando.</h1><p>As publicações das lojas aparecerão aqui.</p></div>}
      {error && <div className="social-feed-state"><p>{error}</p><button onClick={() => void load(cursor)}>Tentar novamente</button></div>}
      {loading && <div className="social-feed-loading">Carregando produtos…</div>}
      <div ref={sentinel} className="social-feed-sentinel" />
    </main>
  </div>
}
