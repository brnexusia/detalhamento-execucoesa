import type { AdminBootstrap, Catalog, PublicPayload } from './types'

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

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
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
  register: (body: { name: string; email: string; password: string; storeName: string; whatsapp: string }) => request<{ ok: true; storeSlug: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: { id: string; name: string; email: string }; store: unknown }>('/api/auth/me'),
  bootstrap: () => request<AdminBootstrap>('/api/admin/bootstrap'),
  updateStore: (body: Record<string, unknown>) => request('/api/admin/store', { method: 'PUT', body: JSON.stringify(body) }),
  createProduct: (body: Record<string, unknown>) => request('/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) => request(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProduct: (id: string) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
  updateStock: (productId: string, body: { enabled: boolean; quantity: number; variantStock: Record<string, number> }) => request<{ product: { id: string; stock_enabled: boolean; stock_quantity: number; variant_stock: Record<string, number> } }>(`/api/admin/features/products/${encodeURIComponent(productId)}/stock`, { method: 'PATCH', body: JSON.stringify(body) }),
  cancelOrder: (orderId: string) => request<{ order: { id: string; status: string; stock_reverted: boolean }; idempotent: boolean }>(`/api/admin/features/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: '{}' }),
  catalogs: () => request<{ catalogs: AdminCatalog[] }>('/api/admin/catalogs'),
  createCatalog: (body: { name: string; kind: 'geral' | 'atacado' | 'varejo'; minimumOrder?: number | null }) => request<{ catalog: AdminCatalog }>('/api/admin/catalogs', { method: 'POST', body: JSON.stringify(body) }),
  updateCatalog: (catalogId: string, body: { name?: string; kind?: 'geral' | 'atacado' | 'varejo'; minimumOrder?: number | null; active?: boolean; items?: Array<{ productId: string; priceOverride: number | null; visible: boolean }> }) => request<{ catalog: Catalog }>(`/api/admin/catalogs/${encodeURIComponent(catalogId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
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
