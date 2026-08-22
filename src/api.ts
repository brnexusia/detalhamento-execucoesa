import type { AdminBootstrap, PublicPayload } from './types'

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

export const api = {
  publicStore: (storeSlug: string, sellerSlug?: string) => request<PublicPayload>(`/api/public/store/${encodeURIComponent(storeSlug)}${sellerSlug ? `/${encodeURIComponent(sellerSlug)}` : ''}`),
  track: (body: { storeSlug: string; sellerSlug?: string; kind: 'view' | 'cart' | 'whatsapp' }) => request<void>('/api/public/events', { method: 'POST', body: JSON.stringify(body) }).catch(() => undefined),
  createOrder: (body: { storeSlug: string; sellerSlug?: string; items: Array<{ productId: string; quantity: number; selections: Record<string, string> }> }) => request<{ code: string; whatsappUrl: string }>('/api/public/orders', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) => request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body: { name: string; email: string; password: string; storeName: string; whatsapp: string }) => request<{ ok: true; storeSlug: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: { id: string; name: string; email: string }; store: unknown }>('/api/auth/me'),
  bootstrap: () => request<AdminBootstrap>('/api/admin/bootstrap'),
  updateStore: (body: Record<string, unknown>) => request('/api/admin/store', { method: 'PUT', body: JSON.stringify(body) }),
  createProduct: (body: Record<string, unknown>) => request('/api/admin/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) => request(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProduct: (id: string) => request(`/api/admin/products/${id}`, { method: 'DELETE' }),
  createSeller: (body: Record<string, unknown>) => request('/api/admin/sellers', { method: 'POST', body: JSON.stringify(body) }),
  updateSeller: (id: string, body: Record<string, unknown>) => request(`/api/admin/sellers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSeller: (id: string) => request(`/api/admin/sellers/${id}`, { method: 'DELETE' }),
  upload: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string; type: 'image' | 'video' }>('/api/admin/upload', { method: 'POST', body: form })
  },
}
