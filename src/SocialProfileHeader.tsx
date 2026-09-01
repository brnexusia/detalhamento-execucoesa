import { useEffect, useState } from 'react'
import { Grid2X2, Store } from 'lucide-react'

type ProfilePayload = {
  store: {
    id: string
    slug: string
    name: string
    tagline: string
    eyebrow: string
    logoUrl: string
    accent: string
    planTier: 'bronze' | 'prata' | 'ouro'
    productCount: number
  }
  stats: { followers: number; views: number }
}

function storeSlug() {
  return window.location.pathname.split('/').filter(Boolean)[0] || ''
}

export default function SocialProfileHeader() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null)

  useEffect(() => {
    const slug = storeSlug()
    if (!slug) return
    const controller = new AbortController()
    fetch(`/api/social/stores/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setProfile(data) })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  if (!profile) return null
  const { store, stats } = profile

  return <section className="social-profile" style={{ '--profile-accent': store.accent || '#111318' } as React.CSSProperties}>
    <div className="social-profile__brand"><span>SHOPVAX</span><small>Perfil da loja</small></div>
    <div className="social-profile__main">
      <div className="social-profile__avatar">{store.logoUrl ? <img src={store.logoUrl} alt="" /> : <Store size={30} />}</div>
      <div className="social-profile__identity"><h1>{store.name}</h1><p>{store.tagline}</p><span>@{store.slug}</span></div>
      <div className="social-profile__stats">
        <div><strong>{store.productCount}</strong><span>produtos</span></div>
        <div><strong>{stats.followers}</strong><span>seguidores</span></div>
        <div><strong>{stats.views}</strong><span>views</span></div>
      </div>
    </div>
    <div className="social-profile__tabs"><span className="is-active"><Grid2X2 size={16}/> Publicações</span></div>
  </section>
}
