export type Product = {
  id: string
  sku: string
  name: string
  description: string
  price: number
  category: string
  image: string
  pack?: string
  colors?: string[]
  featured?: boolean
}

export type Seller = {
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
  sellers: Seller[]
}

export type CartItem = {
  product: Product
  quantity: number
}
