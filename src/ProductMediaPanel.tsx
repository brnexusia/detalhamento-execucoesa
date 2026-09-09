import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ImagePlus, RefreshCcw, Save, Trash2, Upload } from 'lucide-react'
import { api } from './api'
import type { AdminBootstrap, AdminProduct } from './types'
import './product-media-panel.css'

type PlanContext = {
  plan: {
    code: string
    name: string
    limits: {
      sellers: number | null
      products: number | null
      catalogs: number | null
      photosPerProduct: number | null
      franchisees: number | null
    }
  }
  usage: { products: number; sellers: number; catalogs: number }
}

type GalleryDraft = Record<string, string[]>

async function jsonRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

function unique(values: string[]) {
  const seen = new Set<string>()
  return values.map((value) => String(value || '').trim()).filter((value) => value && !seen.has(value) && seen.add(value))
}

function productImages(product: AdminProduct) {
  const base = Array.isArray(product.images) ? product.images : []
  const primary = product.media_type === 'image' ? product.media_url : ''
  return unique([...base, primary].filter(Boolean))
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const copy = [...items]
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

export default function ProductMediaPanel() {
  const [data, setData] = useState<AdminBootstrap | null>(null)
  const [plan, setPlan] = useState<PlanContext | null>(null)
  const [drafts, setDrafts] = useState<GalleryDraft>({})
  const [saved, setSaved] = useState<GalleryDraft>({})
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [bootstrap, context] = await Promise.all([
        api.bootstrap(),
        jsonRequest<PlanContext>('/api/admin/plan-context'),
      ])
      const galleries = Object.fromEntries(bootstrap.products.map((product) => [product.id, productImages(product)]))
      setData(bootstrap)
      setPlan(context)
      setDrafts(galleries)
      setSaved(galleries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as fotos dos produtos.')
    }
  }

  useEffect(() => { void load() }, [])

  const limit = plan?.plan.limits.photosPerProduct ?? null
  const dirtyCount = useMemo(() => Object.keys(drafts).filter((id) => JSON.stringify(drafts[id] || []) !== JSON.stringify(saved[id] || [])).length, [drafts, saved])
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2300) }

  const saveGallery = async (product: AdminProduct, images = drafts[product.id] || []) => {
    setBusy(`save:${product.id}`)
    setError('')
    try {
      const result = await jsonRequest<{ product: { images: string[] }; limit: number | null }>(`/api/admin/products/${encodeURIComponent(product.id)}/gallery`, {
        method: 'PATCH',
        body: JSON.stringify({ images }),
      })
      const normalized = unique(result.product.images || images)
      setDrafts((current) => ({ ...current, [product.id]: normalized }))
      setSaved((current) => ({ ...current, [product.id]: normalized }))
      flash(`Fotos de ${product.name} salvas.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a galeria.')
    } finally { setBusy('') }
  }

  const uploadFiles = async (product: AdminProduct, fileList: FileList | null) => {
    if (!fileList?.length) return
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return setError('Escolha uma ou mais imagens.')
    const current = drafts[product.id] || []
    const available = limit == null ? files.length : Math.max(0, limit - current.length)
    if (available <= 0) return setError(`O ${plan?.plan.name || 'plano'} já atingiu o limite de ${limit} fotos neste produto.`)
    const selected = files.slice(0, available)
    setBusy(`upload:${product.id}`)
    setError('')
    try {
      const urls: string[] = []
      for (const file of selected) {
        const uploaded = await api.upload(file)
        if (uploaded.type !== 'image') continue
        urls.push(uploaded.url)
      }
      const next = unique([...current, ...urls])
      setDrafts((value) => ({ ...value, [product.id]: next }))
      await saveGallery(product, next)
      if (selected.length < files.length) flash(`Fotos adicionadas até o limite de ${limit} do ${plan?.plan.name || 'plano'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar as fotos.')
      setBusy('')
    }
  }

  if (!data || !plan) {
    return <div className="media-manager-shell"><div className="media-manager-loading"><ImagePlus size={30}/><strong>Carregando fotos dos produtos…</strong>{error && <p>{error}</p>}<button onClick={load}><RefreshCcw size={16}/> Tentar novamente</button></div></div>
  }

  return <div className="media-manager-shell">
    <header className="media-manager-head">
      <div><span>Fase 1 · Produtos</span><h1>Fotos dos produtos</h1><p>Gerencie todas as imagens do mesmo produto. A primeira foto é usada como capa da loja.</p></div>
      <div className="media-plan-card"><small>Plano atual</small><strong>{plan.plan.name}</strong><span>{limit == null ? 'Fotos sem limite definido' : `Até ${limit} fotos por produto`}</span></div>
    </header>

    {notice && <div className="media-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="media-error">{error}</div>}
    {dirtyCount > 0 && <div className="media-pending"><strong>{dirtyCount}</strong> produto(s) com alterações ainda não salvas.</div>}

    <div className="media-product-list">
      {data.products.map((product) => {
        const images = drafts[product.id] || []
        const isDirty = JSON.stringify(images) !== JSON.stringify(saved[product.id] || [])
        const atLimit = limit != null && images.length >= limit
        const working = busy.endsWith(product.id)
        return <article className="media-product-card" key={product.id}>
          <div className="media-product-title">
            <div className="media-product-cover">{images[0] ? <img src={images[0]} alt=""/> : product.media_type === 'video' && product.media_url ? <video src={product.media_url} muted/> : <ImagePlus size={25}/>}</div>
            <div><small>{product.sku || 'SEM SKU'} · {product.category}</small><h2>{product.name}</h2><span>{images.length}{limit == null ? '' : `/${limit}`} foto(s){product.media_type === 'video' ? ' + vídeo principal' : ''}</span></div>
            <div className="media-product-actions">
              <label className={atLimit ? 'is-disabled' : ''}><Upload size={16}/>{working && busy.startsWith('upload:') ? 'Enviando…' : 'Adicionar fotos'}<input type="file" accept="image/*" multiple disabled={working || atLimit} onChange={(event) => { void uploadFiles(product, event.target.files); event.currentTarget.value = '' }}/></label>
              <button disabled={!isDirty || working} onClick={() => void saveGallery(product)}><Save size={16}/>{working && busy.startsWith('save:') ? 'Salvando…' : 'Salvar ordem'}</button>
            </div>
          </div>

          {images.length > 0 ? <div className="media-gallery-grid">{images.map((image, index) => <div className="media-gallery-item" key={`${image}-${index}`}>
            <img src={image} alt={`${product.name} ${index + 1}`}/>
            {index === 0 && <span className="media-cover-badge">Capa</span>}
            <div className="media-gallery-controls">
              <button aria-label="Mover foto para esquerda" disabled={index === 0 || working} onClick={() => setDrafts((current) => ({ ...current, [product.id]: move(images, index, -1) }))}><ChevronLeft size={16}/></button>
              {index > 0 && <button className="make-cover" disabled={working} onClick={() => setDrafts((current) => ({ ...current, [product.id]: [image, ...images.filter((_, itemIndex) => itemIndex !== index)] }))}>Capa</button>}
              <button aria-label="Mover foto para direita" disabled={index === images.length - 1 || working} onClick={() => setDrafts((current) => ({ ...current, [product.id]: move(images, index, 1) }))}><ChevronRight size={16}/></button>
              <button className="remove-photo" aria-label="Remover foto" disabled={working} onClick={() => setDrafts((current) => ({ ...current, [product.id]: images.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 size={16}/></button>
            </div>
          </div>)}</div> : <div className="media-empty-gallery"><ImagePlus size={26}/><div><strong>Nenhuma foto cadastrada.</strong><span>Adicione a primeira imagem deste produto.</span></div></div>}

          {atLimit && <p className="media-limit-note">Limite de {limit} fotos atingido neste produto. Remova uma foto para adicionar outra.</p>}
        </article>
      })}
    </div>

    {!data.products.length && <div className="media-manager-empty"><ImagePlus size={32}/><h2>Cadastre um produto primeiro.</h2><p>Assim que houver produtos, as galerias aparecem aqui.</p></div>}
  </div>
}
