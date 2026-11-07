import { notifyAuthChange, listenAuthChanges } from './auth-session-sync'
import { prepareCatalogPhoto } from './catalog-photo-upload'
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
  published_count?: number
  skipped_existing_count?: number
  publish_mode?: 'separate' | 'grouped' | null
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

// Share only simultaneously pending plain GETs. Never cache responses or
// deduplicate mutations, uploads, credentialed overrides or abortable requests.
const inFlightGets = new Map<string, Promise<unknown>>()
if (typeof window !== 'undefined') {
  // Never join a request issued under the previous authentication context.
  listenAuthChanges('owner', () => inFlightGets.clear())
  listenAuthChanges('customer', () => inFlightGets.clear())
}

export function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  if (method !== 'GET' || options.body || options.headers || options.signal ||
      options.credentials || options.cache || options.mode || options.redirect ||
      !url.startsWith('/api/')) {
    return performApiRequest<T>(url, options)
  }
  const active = inFlightGets.get(url)
  if (active) return active as Promise<T>
  const current = performApiRequest<T>(url, options).finally(() => {
    if (inFlightGets.get(url) === current) inFlightGets.delete(url)
  })
  inFlightGets.set(url, current)
  return current
}

async function performApiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
  } catch (error) {
    // Falhas de proxy/rede em uploads precisam ser acionáveis, não "Failed to fetch".
    if (options.body instanceof FormData && error instanceof TypeError) {
      throw new Error('A conexão foi interrompida durante o envio. Confira sua internet e tente novamente. Se persistir, informe o suporte.')
    }
    throw error
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const isUpload = options.body instanceof FormData
    const pdfUpload = url === '/api/admin/imports/pdf'
    const uploadIssue = isUpload
      ? response.status === 413
        ? pdfUpload ? 'O servidor recusou o tamanho do PDF (HTTP 413).' : 'O servidor recusou o tamanho da foto (HTTP 413).'
        : [502,503,504].includes(response.status)
          ? pdfUpload ? 'Falha na transferência do PDF (HTTP ' + response.status + ').'
            : 'Falha no envio da mídia (HTTP ' + response.status + ').'
          : ''
      : ''
    const requestId = isUpload ? response.headers.get('x-upload-request-id') : null
    const detail = payload?.error || uploadIssue || 'Não foi possível concluir a operação.'
    const error = new Error(requestId ? detail + ' Protocolo: ' + requestId : detail) as Error & { status?: number; code?: string }
    error.status = response.status
    if (payload?.code) error.code = String(payload.code)
    throw error
  }
  if (options.method?.toUpperCase() === 'POST') {
    if (/^\/api\/auth\/(logout|logout-all)$/.test(url) || url === '/api/public/customers/logout') {
      // A successful HTTP code alone is not proof: reverse proxies can serve HTML.
      if (payload?.ok !== true) throw new Error('O servidor não confirmou o encerramento da sessão.')
      // Revogação confirmada no banco: atualizar ambos os papéis em todas as abas.
      notifyAuthChange('owner', 'logout')
      notifyAuthChange('customer', 'logout')
    } else {
      const scope = /^\/api\/auth\/(login|register|google)$/.test(url)
        ? 'owner'
        : /^\/api\/public\/store\/[^/]+\/customers\/(login|register)$/.test(url)
          ? 'customer' : null
      if (scope && (url !== '/api/auth/google' || payload?.ok === true)) notifyAuthChange(scope)
      if (url === '/api/public/buyer-auth/verify-code') notifyAuthChange('customer')
    }
  }
  if (options.method?.toUpperCase() === 'PUT' && url === '/api/public/buyer-auth/profile') {
    notifyAuthChange('customer')
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
  publicStore: (storeSlug: string, sellerSlug?: string, options: { cursor?: string | null; q?: string; category?: string; sort?: 'newest' | 'price_asc' | 'price_desc'; limit?: number; catalog?: string; signal?: AbortSignal } = {}) => {
    const params = new URLSearchParams()
    if (options.cursor) params.set('cursor', options.cursor)
    if (options.q) params.set('q', options.q)
    if (options.category) params.set('category', options.category)
    if (options.sort && options.sort !== 'newest') params.set('sort', options.sort)
    if (options.limit) params.set('limit', String(options.limit))
    const catalog = options.catalog ?? currentCatalogSlug()
    if (catalog) params.set('catalog', catalog)
    const query = params.toString()
    // O timeout aplica-se somente à leitura pública; pedidos e outras mutações não são repetidos.
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    return request<PublicPayload>(`/api/public/store/${encodeURIComponent(storeSlug)}${sellerSlug ? `/${encodeURIComponent(sellerSlug)}` : ''}${query ? `?${query}` : ''}`, { signal: controller.signal })
      .finally(() => { window.clearTimeout(timeout); options.signal?.removeEventListener('abort', onAbort) })
  },
  track: (body: { storeSlug: string; sellerSlug?: string; kind: 'view' | 'cart' | 'whatsapp' }) => request<void>('/api/public/events', { method: 'POST', body: JSON.stringify(body) }).catch(() => undefined),
  createOrder: (body: { storeSlug: string; sellerSlug?: string; catalogSlug?: string; buyer?: { name?: string; city?: string; cep?: string; phone?: string }; notes?: string; items: Array<{ productId: string; quantity: number; selections: Record<string, string> }> }) => request<{ code: string; orderId?: string; catalog?: Catalog; whatsappUrl: string }>('/api/business/orders', { method: 'POST', body: JSON.stringify({ ...body, catalogSlug: body.catalogSlug ?? currentCatalogSlug() }) }),
  login: (body: { email: string; password: string }) => request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  googleConfig: () => request<{ enabled: boolean; clientId: string | null }>('/api/public/auth/google-config'),
  googleAuth: (body: GoogleAuthBody) => googleAuthRequest(body),
  register: (body: { name: string; email: string; password: string; storeName: string; whatsapp: string; planCode: string; referralCode?: string }) => request<{ ok: true; storeSlug: string; planCode: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout-all', { method: 'POST' }),
  me: () => request<{ user: { id: string; name: string; email: string }; store: { id: string; slug: string; name: string; plan_tier?: string } }>('/api/auth/me'),
  bootstrap: () => request<AdminBootstrap>('/api/admin/bootstrap'),
  bootstrapCompact: () => request<AdminBootstrap>('/api/admin/bootstrap?compact=1'),
  listAdminProducts: (options: { page: number; limit?: number; q?: string; category?: string }) => {
    const params = new URLSearchParams({ page: String(options.page), limit: String(options.limit || 18) })
    if (options.q?.trim()) params.set('q', options.q.trim())
    if (options.category && options.category !== 'Todas') params.set('category', options.category)
    return request<{ products: AdminProduct[]; pagination: { page: number; limit: number; total: number } }>(`/api/admin/products?${params}`)
  },
  planContext: () => request<{ plan: { code: string; name: string; monthlyPrice: number; limits: { sellers: number | null; products: number | null; catalogs: number | null; photosPerProduct: number | null; franchisees: number | null }; features: Record<string, boolean> }; usage: { products: number; sellers: number; catalogs: number } }>('/api/admin/plan-context'),
  updateStore: (body: Record<string, unknown>) => request('/api/admin/store', { method: 'PUT', body: JSON.stringify(body) }),
  createProduct: (body: Record<string, unknown>) => request<{ product: AdminProduct }>('/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) => request<{ product: AdminProduct }>(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateProductGallery: (id: string, images: string[]) => request<{ product: { id: string; images: string[] }; limit: number | null }>(`/api/admin/products/${encodeURIComponent(id)}/gallery`, { method: 'PATCH', body: JSON.stringify({ images }) }),
  appendProductGalleryPhoto: (id: string, url: string) => request<{ product: { id: string; images: string[]; media_url: string }; limit: number | null; added: boolean }>(`/api/admin/products/${encodeURIComponent(id)}/gallery/photos`, { method: 'POST', body: JSON.stringify({ url }) }),
  setProductVisibility: (id: string, active: boolean) => request<{ product: { id: string; active: boolean } }>(`/api/admin/products/${encodeURIComponent(id)}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteProduct: (id: string) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
  deleteProducts: (ids: string[]) => request<{ ok: true; deleted: number; ids: string[] }>('/api/admin/products/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  downloadProductsPdf: () => requestBlob('/api/admin/products/pdf'),
  updateStock: (productId: string, body: { enabled: boolean; quantity: number; variantStock: Record<string, number> }) => request<{ product: { id: string; stock_enabled: boolean; stock_quantity: number; variant_stock: Record<string, number> } }>(`/api/admin/features/products/${encodeURIComponent(productId)}/stock`, { method: 'PATCH', body: JSON.stringify(body) }),
  updateOrderStatus: (orderId: string, status: 'whatsapp' | 'em_atendimento' | 'confirmado' | 'arquivado') => request<{ order: { id: string; code: string; status: string } }>(`/api/admin/phase2/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
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
  uploadPdfCatalog: async (file: File, onProgress?: (uploadedBytes: number, totalBytes: number) => void) => {
    const chunkLimit = 512 * 1024
    if (file.size <= chunkLimit) {
      const body = new FormData()
      body.append('file', file)
      return request<{ job: ImportJob; duplicated: boolean }>('/api/admin/imports/pdf', { method: 'POST', body })
    }
    // Large catalog uploads use small resumable requests. This avoids
    // reverse-proxy body/time limits and avoids keeping 15-100 MB in a single
    // in-flight browser request. The server assembles parts in the worker.
    const session = await request<{ uploadId: string; chunkSize: number; totalChunks: number }>(
      '/api/admin/imports/pdf/chunks/start', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
      },
    )
    if (!session.uploadId || session.chunkSize < 1 || session.chunkSize > chunkLimit ||
        session.totalChunks !== Math.ceil(file.size / session.chunkSize)) {
      throw new Error('O servidor não confirmou o envio em partes do PDF.')
    }
    try {
    for (let index = 0; index < session.totalChunks; index++) {
      const start = index * session.chunkSize
      const part = file.slice(start, Math.min(file.size, start + session.chunkSize))
      let sent = false
      let lastError: Error = new Error('Falha no envio do PDF.')
      for (let attempt = 0; attempt < 3; attempt++) {
        let retryable = true
        try {
          const response = await fetch(
            '/api/admin/imports/pdf/chunks/' + encodeURIComponent(session.uploadId) + '/' + index,
            {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: part,
            },
          )
          if (response.ok) { sent = true; break }
          const payload = await response.json().catch(() => null)
          lastError = new Error(payload?.error || 'O envio de uma parte do PDF falhou (HTTP ' + response.status + ').')
          retryable = [429, 502, 503, 504].includes(response.status)
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Falha de conexão no envio do PDF.')
        }
        if (!retryable || attempt === 2) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
      }
      if (!sent) throw lastError
      onProgress?.(Math.min(file.size, start + part.size), file.size)
    }
    return await request<{ job: ImportJob; duplicated: boolean }>('/api/admin/imports/pdf/chunks/complete', {
      method: 'POST', body: JSON.stringify({ uploadId: session.uploadId }),
    })
    } catch (error) {
      // Aborted uploads must not retain their partial PDF bytes for four hours.
      // A successfully finalized session is protected by job_id and won't be deleted.
      await fetch('/api/admin/imports/pdf/chunks/' + encodeURIComponent(session.uploadId), {
        method: 'DELETE', credentials: 'include',
      }).catch(() => undefined)
      throw error
    }
  },
  discardImportJob: (jobId: string) => request<{ ok: true }>(`/api/admin/imports/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
  recoverLegacyPdfImport: (jobId: string) => request<{ recovered: number; recategorized: number; preserved_originals: number; total_published: number; not_split_with_sku: number }>(
    `/api/admin/imports/${encodeURIComponent(jobId)}/recover-pdf`, { method: 'POST', body: '{}' },
  ),
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
    // Reduz fotos de câmera antes do proxy, evitando HTTP 413 e timeout.
    const prepared = await prepareCatalogPhoto(file)
    if (prepared.size > 30 * 1024 * 1024) throw new Error('O limite é de 30 MB por arquivo.')
    const form = new FormData()
    form.append('file', prepared, prepared.name)
    const uploaded = await request<{ url: string; type: 'image' | 'video' }>('/api/admin/upload', { method: 'POST', body: form })
    if (!uploaded?.url || !['image', 'video'].includes(uploaded.type)) {
      throw new Error('O servidor não confirmou o envio da foto. Tente novamente.')
    }
    return uploaded
  },
}
