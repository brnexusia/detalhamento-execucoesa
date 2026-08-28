export type VariationGroup = {
  name: string
  options: string[]
}

export type Product = {
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
  featured?: boolean
}

export type Seller = {
  id?: string | null
  slug: string
  name: string
  phone: string
}

export type Store = {
  slug: string
  name: string
  eyebrow: string
  tagline: string
  minimumOrder: number
  whatsapp: string
  logoUrl?: string
  accent?: string
}

export type CartItem = {
  key: string
  product: Product
  quantity: number
  selections: Record<string, string>
}

export type PublicPayload = {
  store: Store
  seller: Seller
  categories?: string[]
  products: Product[]
  page?: {
    hasMore: boolean
    nextCursor: string | null
    limit: number
  }
}

export type AdminProduct = {
  id: string
  sku: string
  name: string
  description: string
  price: number
  category: string
  media_url: string
  media_type: 'image' | 'video'
  pack: string
  variations: VariationGroup[]
  featured: boolean
  active: boolean
}

export type AdminStore = {
  id: string
  slug: string
  name: string
  eyebrow: string
  tagline: string
  minimum_order: number
  whatsapp: string
  logo_url: string
  accent: string
  is_active: boolean
}

export type AdminSeller = {
  id: string
  slug: string
  name: string
  phone: string
  is_active: boolean
}

export type AdminOrder = {
  id: string
  code: string
  total: number
  items: Array<{
    name: string
    sku: string
    quantity: number
    unitPrice: number
    lineTotal: number
    selections: Record<string, string>
  }>
  status: string
  seller_id?: string | null
  created_at: string
}

export type AdminBootstrap = {
  user: { id: string; email: string; name: string }
  store: AdminStore
  products: AdminProduct[]
  sellers: AdminSeller[]
  orders: AdminOrder[]
  stats: { views: number; carts: number; orders: number; value: number }
}
