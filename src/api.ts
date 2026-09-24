import type { AdminBootstrap, AdminProduct, Catalog, PublicPayload } from './types'

export type ImportJob = {
  id: string
  source_url: string
  source_host: string
  status: 'queued' | 'scanning' | 'processing' | 'review' | 'completed' | 'failed' | 'cancelled'
  progress: number
  result_count: number
  normalized_count: number
  warning_count: number
  duplicate_count: number
  selected_count: number
  review_changed_count: number
  platform: string
  pages_scanned: number
  error: string
  created_at: string
  updated_at: string
}

export type ImportReviewData = {
  name: string
  description: string
  sku: string
  category: string
  brand: string
  price: number | null
  currency: string
  images: string[]
  media_url: string
  media_type: 'image' | 'video'
  pack: string
  variations: Array<{ name: string; options: string[] }>
  availability: string
  source_url: string
  source: string
}

export type NormalizedImportProduct = {
  id: string
  source_candidate_id: string | null
  normalized_data: ImportReviewData
  warnings: string[]
  confidence: number
  created_at: string
}

export type ImportReviewProduct = {
  id: string
  source_candidate_id: string | null
  data: ImportReviewData
  original_data: ImportReviewData
  warnings: string[]
  confidence: number
  selected: boolean
  edited: boolean
  review_updated_at: string | null
  created_at: string
}

export type ImportReviewSummary = {
  total_count: number
  selected_count: number
  warning_count: number
  ready_count: number
  review_changed_count: number
}

export type AdminCatalog = Catalog & {
  items: Array<{ productId: string; priceOverride: number | null; visible: boolean }>
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || 'Não foi possível concluir a operação.') as Error & { status?: number; code?: string }
    error.status = response.status
    if (payload?.code) error.code = String(payload.code)
    throw error
  }
  return payload as T
}

const request = apiRequest

type GoogleAuthBody = { credential: string; intent: 'login' | 'register'; storeName?: string; whatsapp?: string; planCode?: string; referralCode?: string }
type GoogleAuthResult =
  | { ok: true; created: boolean; storeSlug?: string; profile: { name: string; email: string; picture?: string } }
  | { ok: false; needsSignup: true; profile: { name: string; email: string; picture?: string } }

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function googleAuthRequest(body: GoogleAuthBody, attempt = 0): Promise<GoogleAuthResult> {
  try {
    return await request<GoogleAuthResult>('/api/auth/google', { method: 'POST', body: JSON.stringify(body) })
  } catch (error) {
    const current = error as Error & { status?: number; code?: string }
    if (body.intent === 'register' && current.code === 'GOOGLE_ALREADY_REGISTERED') {
      return request<GoogleAuthResult>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: body.credential, intent: 'login' }),
      })
    }

    const networkFailure = error instanceof TypeError || /failed to fetch|network(?:error| changed)|load failed/i.test(current.message || '')
    if (networkFailure && attempt < 2) {
      await wait(attempt === 0 ? 450 : 1100)
      return googleAuthRequest(body, attempt + 1)
    }
    if (networkFailure) {
      const friendly = new Error('A conexão mudou durante o acesso ao Google. Tente novamente em alguns segundos.') as Error & { code?: string }
      friendly.code = 'GOOGLE_NETWORK_CHANGED'
      throw friendly
    }
    throw error
  }
}

async function requestBlob(url: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Não foi possível gerar o arquivo.')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'catalogo-shopvax.pdf'
  return { blob: await response.blob(), filename }
}

function currentCatalogSlug() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('catalog') || ''
}

export const api = {
  publicStore: (storeSlug: string, sellerSlug?: string, options: { cursor?: string | null; q?: string; category?: string; limit?: number; catalog?: string } = {}) => {
    const params = new URLSearchParams()
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.q) params.set('q', options.q)
    if (options.category) params.set('category', options.category)
    if (options.limit) params.set('limit', String(options.limit))
    const catalog = options.catalog ?? currentCatalogSlug()
    if (catalog) params.set('catalog', catalog)
    const query = params.toString()
    return request<PublicPayload>(`/api/public/store/${encodeURIComponent(storeSlug)}${sellerSlug ? `/${encodeURIComponent(sellerSlug)}` : ''}${query ? `?${query}` : ''}`)
  },
  track: (body: { storeSlug: string; sellerSlug?: string; kind: 'view' | 'cart' | 'whatsapp' }) => request<void>('/api/public/events', { method: 'POST', body: JSON.stringify(body) }).catch(() => undefined),
  createOrder: (body: { storeSlug: string; sellerSlug?: string; catalogSlug?: string; items: Array<{ productId: string; quantity: number; selections: Record<string, string> }> }) => request<{ code: string; orderId?: string; catalog?: Catalog; whatsappUrl: string }>('/api/business/orders', { method: 'POST', body: JSON.stringify({ ...body, catalogSlug: body.catalogSlug ?? currentCatalogSlug() }) }),
  login: (body: { email: string; password: string }) => request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  googleConfig: () => request<{ enabled: boolean; clientId: string | null }>('/api/public/auth/google-config'),
  googleAuth: (body: GoogleAuthBody) => googleAuthRequest(body),
  register: (body: { name: string; email: string; password: string; storeName: string; whatsapp: string; planCode: string; referralCode?: string }) => request<{ ok: true; storeSlug: string; planCode: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: { id: string; name: string; email: string }; store: { id: string; slug: string; name: string; plan_tier?: string } }>('/api/auth/me'),
  bootstrap: () => request<AdminBootstrap>('/api/admin/bootstrap'),
  planContext: () => request<{ plan: { code: string; name: string; monthlyPrice: number; limits: { sellers: number | null; products: number | null; catalogs: number | null; photosPerProduct: number | null; franchisees: number | null }; features: Record<string, boolean> }; usage: { products: number; sellers: number; catalogs: number } }>('/api/admin/plan-context'),
  updateStore: (body: Record<string, unknown>) => request('/api/admin/store', { method: 'PUT', body: JSON.stringify(body) }),
  createProduct: (body: Record<string, unknown>) => request<{ product: AdminProduct }>('/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) => request<{ product: AdminProduct }>(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateProductGallery: (id: string, images: string[]) => request<{ product: { id: string; images: string[] }; limit: number | null }>(`/api/admin/products/${encodeURIComponent(id)}/gallery`, { method: 'PATCH', body: JSON.stringify({ images }) }),
  setProductVisibility: (id: string, active: boolean) => request<{ product: { id: string; active: boolean } }>(`/api/admin/products/${encodeURIComponent(id)}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteProduct: (id: string) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
  updateStock: (productId: string, body: { enabled: boolean; quantity: number; variantStock: Record<string, number> }) => request<{ product: { id: string; stock_enabled: boolean; stock_quantity: number; variant_stock: Record<string, number> } }>(`/api/admin/features/products/${encodeURIComponent(productId)}/stock`, { method: 'PATCH', body: JSON.stringify(body) }),
  cancelOrder: (orderId: string) => request<{ order: { id: string; status: string; stock_reverted: boolean }; idempotent: boolean }>(`/api/admin/features/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: '{}' }),
  catalogs: () => request<{ catalogs: AdminCatalog[] }>('/api/admin/catalogs'),
  createCatalog: (body: { name: string; kind: 'geral' | 'atacado' | 'varejo'; minimumOrder?: number | null }) => request<{ catalog: AdminCatalog }>('/api/admin/catalogs', { method: 'POST', body: JSON.stringify(body) }),
  updateCatalog: (catalogId: string, body: { name?: string; kind?: 'geral' | 'atacado' | 'varejo'; minimumOrder?: number | null; active?: boolean; items?: Array<{ productId: string; priceOverride: number | null; visible: boolean }> }) => request<{ catalog: Catalog }>(`/api/admin/catalogs/${encodeURIComponent(catalogId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  downloadCatalogPdf: (catalogId: string) => requestBlob(`/api/admin/catalogs/${encodeURIComponent(catalogId)}/pdf`),
  deleteCatalog: (catalogId: string) => request<void>(`/api/admin/catalogs/${encodeURIComponent(catalogId)}`, { method: 'DELETE' }),
  createSeller: (body: Record<string, unknown>) => request('/api/admin/sellers', { method: 'POST', body: JSON.stringify(body) }),
  updateSeller: (id: string, body: Record<string, unknown>) => request(`/api/admin/sellers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSeller: (id: string) => request(`/api/admin/sellers/${id}`, { method: 'DELETE' }),
  listImportJobs: () => request<{ jobs: ImportJob[] }>('/api/admin/imports'),
  createImportJob: (url: string) => request<{ job: ImportJob; duplicated: boolean }>('/api/admin/imports', { method: 'POST', body: JSON.stringify({ url }) }),
  discardImportJob: (jobId: string) => request<{ ok: true }>(`/api/admin/imports/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
  importCandidates: (jobId: string, limit = 25) => request<{ job: ImportJob; candidates: Array<{ id: string; source_url: string; raw_data: Record<string, unknown>; created_at: string }> }>(`/api/admin/imports/${encodeURIComponent(jobId)}/candidates?limit=${limit}`),
  normalizedImportProducts: (jobId: string, limit = 25) => request<{ job: ImportJob; products: NormalizedImportProduct[] }>(`/api/admin/imports/${encodeURIComponent(jobId)}/normalized?limit=${limit}`),
  reviewImportProducts: (jobId: string, options: { limit?: number; offset?: number; filter?: 'all' | 'alerts' | 'selected'; q?: string } = {}) => {
    const params = new URLSearchParams()
    params.set('limit', String(options.limit ?? 40))
    params.set('offset', String(options.offset ?? 0))
    if (options.filter) params.set('filter', options.filter)
    if (options.q) params.set('q', options.q)
    return request<{ job: ImportJob; products: ImportReviewProduct[]; summary: ImportReviewSummary; pagination: { limit: number; offset: number; total: number } }>(`/api/admin/imports/${encodeURIComponent(jobId)}/review?${params.toString()}`)
  },
  updateImportReviewProduct: (jobId: string, productId: string, body: { data?: Partial<ImportReviewData>; selected?: boolean }) => request<{ product: ImportReviewProduct; summary: ImportReviewSummary; job: ImportJob }>(`/api/admin/imports/${encodeURIComponent(jobId)}/review/${encodeURIComponent(productId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateImportReviewSelection: (jobId: string, action: 'ready' | 'none') => request<{ summary: ImportReviewSummary; job: ImportJob }>(`/api/admin/imports/${encodeURIComponent(jobId)}/review-selection`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  upload: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string; type: 'image' | 'video' }>('/api/admin/upload', { method: 'POST', body: form })
  },
}
