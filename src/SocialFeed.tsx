import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Play, Store } from 'lucide-react'
import './social-feed.css'

type SocialPost = {
  id: string
  product: {
    id: string
    sku: string
    name: string
    description: string
    price: number
    category: string
    mediaUrl: string
    mediaType: 'image' | 'video'
    publishedAt: string
  }
  store: {
    id: string
    slug: string
    name: string
    logoUrl: string
    accent: string
    planTier: 'bronze' | 'prata' | 'ouro'
  }
}

type FeedPayload = { posts: SocialPost[]; page: { hasMore: boolean; nextCursor: string | null } }
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function openStore(slug: string) {
  window.location.assign(`/${encodeURIComponent(slug)}`)
}

export default function SocialFeed() {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sentinel = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (nextCursor?: string | null) => {
    if (loading || (!hasMore && nextCursor)) return
    setLoading(true)
    setError('')
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
      setCursor(body.page?.nextCursor || null)
      setHasMore(Boolean(body.page?.hasMore))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o feed.')
    } finally { setLoading(false) }
  }, [hasMore, loading])

  useEffect(() => { void load(null) }, [])
  useEffect(() => {
    const target = sentinel.current
    if (!target || !hasMore || loading) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && cursor) void load(cursor)
    }, { rootMargin: '900px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [cursor, hasMore, loading, load])

  return <div className="social-feed-page">
    <header className="social-feed-nav"><strong>SHOPVAX</strong><span>Descobrir</span><a href="/entrar">Entrar</a></header>
    <main className="social-feed-list">
      {posts.map((post) => <article className="social-feed-card" key={post.id}>
        <div className="social-feed-media">
          {post.product.mediaType === 'video'
            ? <video src={post.product.mediaUrl} autoPlay loop muted playsInline preload="metadata" />
            : post.product.mediaUrl
              ? <img src={post.product.mediaUrl} alt={post.product.name} loading="lazy" />
              : <div className="social-feed-media__empty"><Play size={34}/></div>}
          <div className="social-feed-shade" />
        </div>
        <button className="social-feed-store" onClick={() => openStore(post.store.slug)}>
          <span className="social-feed-store__avatar">{post.store.logoUrl ? <img src={post.store.logoUrl} alt=""/> : <Store size={20}/>}</span>
          <span><strong>{post.store.name}</strong><small>@{post.store.slug}</small></span>
          <ChevronRight size={18}/>
        </button>
        <div className="social-feed-copy">
          <span>{post.product.category}</span>
          <h2>{post.product.name}</h2>
          {post.product.description && <p>{post.product.description}</p>}
          <div><strong>{money.format(post.product.price)}</strong><button onClick={() => openStore(post.store.slug)}>Ver na loja <ChevronRight size={17}/></button></div>
        </div>
      </article>)}
      {!posts.length && !loading && !error && <div className="social-feed-state"><h1>O feed está começando.</h1><p>As publicações das lojas aparecerão aqui.</p></div>}
      {error && <div className="social-feed-state"><p>{error}</p><button onClick={() => void load(cursor)}>Tentar novamente</button></div>}
      {loading && <div className="social-feed-loading">Carregando produtos…</div>}
      <div ref={sentinel} className="social-feed-sentinel" />
    </main>
  </div>
}
