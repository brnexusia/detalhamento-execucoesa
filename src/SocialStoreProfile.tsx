import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Grid2X2, Play, ShoppingBag, Store, X } from 'lucide-react'
const SocialShopping = lazy(() => import('./SocialShopping'))
import './social-profile.css'
import './shopvax-social-official.css'
import { shopvaxAccentTextColor } from './ShopvaxDesignSystem'
import SocialAccountChoice from './SocialAccountChoice'
import { useOwnerSession } from './owner-session'
import { useBuyerSession } from './buyer-session'

type VariationGroup = { name: string; options: string[] }
type Publication = {
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
  publishedAt: string
}
type ProfilePayload = {
  store: { id: string; slug: string; name: string; tagline: string; eyebrow: string; logoUrl: string; accent: string; planTier: 'bronze' | 'prata' | 'ouro'; productCount: number }
  stats: { followers: number; views: number; following: boolean }
}

function routeSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[0] === 'perfil' ? parts[1] || '' : ''
}

function requestedProductId() {
  return new URLSearchParams(window.location.search).get('produto')?.trim().slice(0, 100) || ''
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function SocialStoreProfile() {
  const [slug, setSlug] = useState(routeSlug)
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [publications, setPublications] = useState<Publication[]>([])
  const [publicationsLoading, setPublicationsLoading] = useState(true)
  const [selected, setSelected] = useState<Publication | null>(null)
  const [viewMode,setViewMode] = useState<'feed'|'grade'>('grade')
  const profileFeedRef=useRef<HTMLElement|null>(null)
  const [socialPurchase,setSocialPurchase] = useState<{productId?:string;initialCart?:boolean}|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountChoice, setAccountChoice] = useState<'login' | 'follow' | null>(null)
  const ownerSession = useOwnerSession()
  const buyerSession = useBuyerSession()

  // O SPA deve trocar o perfil quando a URL muda entre lojas sem recarga.
  useEffect(() => {
    const onRoute = () => setSlug(routeSlug())
    window.addEventListener('popstate', onRoute)
    return () => window.removeEventListener('popstate', onRoute)
  }, [])

  useEffect(() => {
    if (!slug) { setProfile(null); setError('Perfil não encontrado.'); setLoading(false); return }
    let active = true
    const controller = new AbortController()
    setProfile(null)
    setPublications([])
    setSelected(null)
    setViewMode('grade')
    setSocialPurchase(null)
    setAccountChoice(null)
    setError('')
    setLoading(true)
    setPublicationsLoading(true)

    // Uma falha nas publicações não pode impedir seguir a loja ou entrar na conta.
    fetch(`/api/social/stores/${encodeURIComponent(slug)}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Perfil não encontrado.')
        return response.json() as Promise<ProfilePayload>
      })
      .then((profileData) => {
        if (!active) return
        setProfile(profileData)
        setLoading(false)
        return fetch(`/api/social/stores/${encodeURIComponent(slug)}/publications`, {
          credentials: 'include', signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error('Publicações indisponíveis. Tente atualizar a página.')
          return response.json() as Promise<{ publications: Publication[] }>
        }).then((publicationData) => {
          if (!active) return
          const items = Array.isArray(publicationData?.publications) ? publicationData.publications : []
          setPublications(items)
          const requested = requestedProductId()
          if (requested) setSelected(items.find((item) => item.id === requested) || null)
        }).catch((err: unknown) => {
          if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
            setError('Publicações indisponíveis. Você ainda pode acessar a loja.')
          }
        }).finally(() => { if (active) setPublicationsLoading(false) })
      })
      .catch((err: unknown) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(err instanceof Error ? err.message : 'Não foi possível abrir o perfil.')
        setLoading(false)
        setPublicationsLoading(false)
      })
    return () => { active = false; controller.abort() }
  }, [slug])

  useEffect(() => {
    const onPop = () => {
      const requested = requestedProductId()
      setSelected(requested ? publications.find((item) => item.id === requested) || null : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [publications])

  useEffect(()=>{
    if(viewMode!=='feed'||Boolean(socialPurchase)||Boolean(selected))return
    const container=profileFeedRef.current
    if(!container)return
    const videos=Array.from(container.querySelectorAll('video'))
    const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const observer=new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        const video=entry.target as HTMLVideoElement
        if(!reduceMotion&&entry.isIntersecting&&entry.intersectionRatio>=.65)
          void video.play().catch(()=>undefined)
        else video.pause()
      })
    },{root:container,threshold:[0,.65,1]})
    videos.forEach(video=>observer.observe(video))
    return()=>{observer.disconnect();videos.forEach(video=>video.pause())}
  },[viewMode,publications,socialPurchase,selected])

  const openPublication = (publication: Publication) => {
    setSelected(publication)
    window.history.pushState({}, '', `/perfil/${encodeURIComponent(slug)}?produto=${encodeURIComponent(publication.id)}`)
  }

  const closePublication = () => {
    setSelected(null)
    window.history.replaceState({}, '', `/perfil/${encodeURIComponent(slug)}`)
  }

  const follow = () => setAccountChoice('follow')

  if (loading) return <div className="social-profile-state"><span><img src="/brand/shopvax-symbol.svg" className="svx-brand-symbol" alt="Shopvax" /></span><strong>Abrindo perfil…</strong></div>
  if (!profile) return <div className="social-profile-state"><strong>{error || 'Perfil não encontrado.'}</strong><button onClick={() => go('/')}>Voltar ao feed</button></div>

  const { store, stats } = profile

  return <div className="social-profile-page">
    <header className="social-profile-nav">
      <button onClick={() => go('/')}><ArrowLeft size={18}/> Feed</button>
      <strong className="svx-social-brand"><img src="/brand/shopvax-symbol-dark.svg" className="svx-brand-symbol" alt="" aria-hidden="true" /><img src="/brand/shopvax-wordmark-light.svg" className="svx-brand-wordmark" alt="Shopvax" /></strong>
      <button type="button" onClick={() => ownerSession === 'authenticated' ? go('/painel') : buyerSession === 'authenticated' ? go('/comprador') : setAccountChoice('login')}>{ownerSession === 'authenticated' ? 'Minha loja' : buyerSession === 'authenticated' ? 'Minha conta' : 'Entrar'}</button>
    </header>

    <main className="social-profile-shell">
      <section className="social-profile-card" style={{ '--profile-accent': store.accent || '#F25C05', '--profile-text': shopvaxAccentTextColor(store.accent || '#F25C05') } as React.CSSProperties}>
        <div className="social-profile-main">
          <div className="social-profile-avatar">{store.logoUrl ? <img src={store.logoUrl} alt={store.name} draggable={false}/> : <Store size={32}/>}</div>
          <div className="social-profile-identity">
            <h1>{store.name}</h1>
            <span>@{store.slug}</span>
            <p>{store.tagline}</p>
            <div className="social-profile-actions">
              <button className={stats.following ? 'is-following' : ''} onClick={follow}>{stats.following ? 'Seguindo' : 'Seguir'}</button>
              <button className="is-store" onClick={() => setViewMode('grade')}><Store size={16}/> Loja</button>
            </div>
          </div>
        </div>
        <div className="social-profile-stats">
          <div><strong>{store.productCount}</strong><span>produtos publicados</span></div>
          <div><strong>{stats.followers}</strong><span>seguidores</span></div>
          <div><strong>{stats.views}</strong><span>views</span></div>
        </div>
        <div className="social-profile-tabs social-profile-view-switch" aria-label="Visualização dos produtos"><button type="button" className={viewMode==='feed'?'is-active':''} aria-pressed={viewMode==='feed'} onClick={()=>setViewMode('feed')}><Play size={16}/> Feed</button><button type="button" className={viewMode==='grade'?'is-active':''} aria-pressed={viewMode==='grade'} onClick={()=>setViewMode('grade')}><Grid2X2 size={16}/> Loja</button><button type="button" className="social-profile-cart-action" onClick={()=>setSocialPurchase({initialCart:true})}><ShoppingBag size={16}/> Carrinho</button></div>
      </section>

      {viewMode==='feed'
        ? <section ref={profileFeedRef} className="social-profile-feed" aria-label={`Feed de produtos de ${store.name}`}>
          {publications.map(publication=><article key={publication.id} className="social-profile-feed-post">
            <button className="social-profile-feed-post__media" type="button" onClick={()=>openPublication(publication)} aria-label={`Abrir ${publication.name}`}>
              {publication.mediaType==='video'
                ? <video src={publication.mediaUrl} poster={publication.images?.[0]||undefined} muted playsInline loop preload="none" aria-hidden="true"/>
                : publication.mediaUrl
                  ? <img src={publication.mediaUrl} alt="" loading="lazy" decoding="async"/>
                  : <span className="social-profile-empty"><Store size={26}/></span>}
              <span className="social-profile-feed-post__title">{publication.name}</span>
            </button>
            <button className="social-profile-feed-post__buy" type="button" onClick={()=>setSocialPurchase({productId:publication.id})}><ShoppingBag size={17}/> Ver preço / Comprar</button>
          </article>)}
        </section>
        : <section className="social-profile-grid" aria-label={`Produtos de ${store.name} em grade`}>
          {publications.map((publication) => <button key={publication.id} onClick={() => openPublication(publication)}>
            {publication.mediaType === 'video'
              ? <><video src={publication.mediaUrl} poster={publication.images?.[0]||undefined} muted playsInline preload="none"/><span className="social-profile-video"><Play size={18} fill="currentColor"/></span></>
              : publication.mediaUrl ? <img src={publication.mediaUrl} alt={publication.name} loading="lazy" decoding="async"/> : <span className="social-profile-empty"><Store size={22}/></span>}
            <span className="social-profile-grid__name">{publication.name}</span>
          </button>)}
        </section>}
      {!publications.length && <div className="social-profile-empty-state" role={error ? "alert" : undefined}>{publicationsLoading ? "Carregando publicações…" : error || "Esta loja ainda não publicou produtos."}</div>}
    </main>

    {socialPurchase&&<Suspense fallback={null}><SocialShopping storeSlug={slug} storeName={store.name} {...socialPurchase} onClose={()=>setSocialPurchase(null)}/></Suspense>}
    {accountChoice && <SocialAccountChoice storeSlug={slug} storeId={profile.store.id} reason={accountChoice}
      onFollowed={(result) => setProfile((current) => current ? { ...current, stats: { ...current.stats, following: result.following, followers: result.followers } } : current)}
      onClose={() => setAccountChoice(null)}/>} 
    {selected && <div className="social-profile-viewer">
      <button className="social-profile-viewer__backdrop" onClick={closePublication} aria-label="Fechar publicação"/>
      <article>
        <button className="social-profile-viewer__close" onClick={closePublication}><X size={21}/></button>
        <div className="social-profile-viewer__media">
          {selected.mediaType === 'video' ? <video src={selected.mediaUrl} poster={selected.images?.[0]||undefined} autoPlay controls playsInline/> : <img src={selected.mediaUrl} alt={selected.name}/>} 
        </div>
        <div className="social-profile-viewer__copy">
          <span>{selected.category}</span>
          <h2>{selected.name}</h2>
          {selected.description && <p>{selected.description}</p>}
          <button onClick={() => setSocialPurchase({productId:selected.id})}><ShoppingBag size={16}/> Ver preço / Comprar</button>
        </div>
      </article>
    </div>}
  </div>
}
