import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Grid2X2, Play, Store, X } from 'lucide-react'
import './social-profile.css'

type VariationGroup = { name: string; options: string[] }
type Publication = {
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
  publishedAt: string
}
type ProfilePayload = {
  store: { id: string; slug: string; name: string; tagline: string; eyebrow: string; logoUrl: string; accent: string; planTier: 'bronze' | 'prata' | 'ouro'; productCount: number }
  stats: { followers: number; views: number; following: boolean }
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

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

async function commercialStorePath(slug: string, productId?: string) {
  let sellerSlug = ''
  try {
    const response = await fetch(`/api/social/stores/${encodeURIComponent(slug)}/seller-route`, { credentials: 'include' })
    const body = await response.json().catch(() => null)
    if (response.ok) sellerSlug = String(body?.seller?.slug || '')
  } catch { /* usa atendimento padrão */ }
  const base = sellerSlug ? `/${encodeURIComponent(slug)}/${encodeURIComponent(sellerSlug)}` : `/${encodeURIComponent(slug)}`
  return productId ? `${base}?produto=${encodeURIComponent(productId)}` : base
}

export default function SocialStoreProfile() {
  const slug = useMemo(routeSlug, [])
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [publications, setPublications] = useState<Publication[]>([])
  const [selected, setSelected] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) { setError('Perfil não encontrado.'); setLoading(false); return }
    setLoading(true)
    Promise.all([
      fetch(`/api/social/stores/${encodeURIComponent(slug)}`, { credentials: 'include' }).then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Perfil não encontrado.'))),
      fetch(`/api/social/stores/${encodeURIComponent(slug)}/publications`, { credentials: 'include' }).then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Publicações indisponíveis.'))),
    ]).then(([profileData, publicationData]) => {
      setProfile(profileData)
      const items = Array.isArray(publicationData?.publications) ? publicationData.publications : []
      setPublications(items)
      const requested = requestedProductId()
      if (requested) setSelected(items.find((item: Publication) => item.id === requested) || null)
    }).catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível abrir o perfil.'))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    const onPop = () => {
      const requested = requestedProductId()
      setSelected(requested ? publications.find((item) => item.id === requested) || null : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [publications])

  const openPublication = (publication: Publication) => {
    setSelected(publication)
    window.history.pushState({}, '', `/perfil/${encodeURIComponent(slug)}?produto=${encodeURIComponent(publication.id)}`)
  }

  const closePublication = () => {
    setSelected(null)
    window.history.replaceState({}, '', `/perfil/${encodeURIComponent(slug)}`)
  }

  const openStore = async (productId?: string) => go(await commercialStorePath(slug, productId))

  const follow = async () => {
    if (!profile) return
    const response = await fetch(`/api/social/stores/${profile.store.id}/follow`, { method: 'POST', credentials: 'include' })
    const body = await response.json().catch(() => null)
    if (response.ok && body) setProfile((current) => current ? { ...current, stats: { ...current.stats, following: body.following, followers: body.followers } } : current)
  }

  if (loading) return <div className="social-profile-state"><span>SV</span><strong>Abrindo perfil…</strong></div>
  if (!profile) return <div className="social-profile-state"><strong>{error || 'Perfil não encontrado.'}</strong><button onClick={() => go('/')}>Voltar ao feed</button></div>

  const { store, stats } = profile

  return <div className="social-profile-page">
    <header className="social-profile-nav">
      <button onClick={() => go('/')}><ArrowLeft size={18}/> Feed</button>
      <strong onClick={() => go('/')}>SHOPVAX</strong>
      <a href="/entrar">Entrar</a>
    </header>

    <main className="social-profile-shell">
      <section className="social-profile-card" style={{ '--profile-accent': store.accent || '#111318' } as React.CSSProperties}>
        <div className="social-profile-main">
          <div className="social-profile-avatar">{store.logoUrl ? <img src={store.logoUrl} alt={store.name}/> : <Store size={32}/>}</div>
          <div className="social-profile-identity">
            <h1>{store.name}</h1>
            <span>@{store.slug}</span>
            <p>{store.tagline}</p>
            <div className="social-profile-actions">
              <button className={stats.following ? 'is-following' : ''} onClick={follow}>{stats.following ? 'Seguindo' : 'Seguir'}</button>
              <button className="is-store" onClick={() => void openStore()}><Store size={16}/> Loja</button>
            </div>
          </div>
        </div>
        <div className="social-profile-stats">
          <div><strong>{store.productCount}</strong><span>publicações</span></div>
          <div><strong>{stats.followers}</strong><span>seguidores</span></div>
          <div><strong>{stats.views}</strong><span>views</span></div>
        </div>
        <div className="social-profile-tabs"><span><Grid2X2 size={16}/> Publicações</span></div>
      </section>

      <section className="social-profile-grid" aria-label={`Publicações de ${store.name}`}>
        {publications.map((publication) => <button key={publication.id} onClick={() => openPublication(publication)}>
          {publication.mediaType === 'video'
            ? <><video src={publication.mediaUrl} muted playsInline preload="metadata"/><span className="social-profile-video"><Play size={18} fill="currentColor"/></span></>
            : publication.mediaUrl ? <img src={publication.mediaUrl} alt={publication.name} loading="lazy" decoding="async"/> : <span className="social-profile-empty"><Store size={22}/></span>}
          <span className="social-profile-grid__name">{publication.name}</span>
        </button>)}
      </section>
      {!publications.length && <div className="social-profile-empty-state">Esta loja ainda não publicou produtos.</div>}
    </main>

    {selected && <div className="social-profile-viewer">
      <button className="social-profile-viewer__backdrop" onClick={closePublication} aria-label="Fechar publicação"/>
      <article>
        <button className="social-profile-viewer__close" onClick={closePublication}><X size={21}/></button>
        <div className="social-profile-viewer__media">
          {selected.mediaType === 'video' ? <video src={selected.mediaUrl} autoPlay controls playsInline/> : <img src={selected.mediaUrl} alt={selected.name}/>} 
        </div>
        <div className="social-profile-viewer__copy">
          <span>{selected.category}</span>
          <h2>{selected.name}</h2>
          {selected.description && <p>{selected.description}</p>}
          <strong>{money.format(selected.price)}</strong>
          <button onClick={() => void openStore(selected.id)}>Abrir na loja <ExternalLink size={16}/></button>
        </div>
      </article>
    </div>}
  </div>
}
