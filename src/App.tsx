import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Grid2X2,
  Heart,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react'
import { products, store } from './data'
import type { CartItem, Product, Seller } from './types'

type ViewMode = 'store' | 'feed'

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const toTitle = (slug: string) =>
  slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

function readRoute() {
  const [storeSlug, sellerSlug] = window.location.pathname.split('/').filter(Boolean)
  return {
    storeSlug: storeSlug || store.slug,
    sellerSlug: sellerSlug || store.sellers[0].slug,
  }
}

function App() {
  const route = useMemo(readRoute, [])
  const [view, setView] = useState<ViewMode>('store')
  const [category, setCategory] = useState('Todos')
  const [query, setQuery] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('atacado-shop-cart')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const seller: Seller =
    store.sellers.find((item) => item.slug === route.sellerSlug) ?? store.sellers[0]

  const storeName = route.storeSlug === store.slug ? store.name : toTitle(route.storeSlug)

  useEffect(() => {
    localStorage.setItem(
      'atacado-shop-attribution',
      JSON.stringify({
        store: route.storeSlug,
        seller: seller.slug,
        firstSeenAt: new Date().toISOString(),
      }),
    )
  }, [route.storeSlug, seller.slug])

  useEffect(() => {
    localStorage.setItem('atacado-shop-cart', JSON.stringify(cart))
  }, [cart])

  const categories = useMemo(
    () => ['Todos', ...Array.from(new Set(products.map((product) => product.category)))],
    [],
  )

  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category
    const text = `${product.name} ${product.sku} ${product.category}`.toLowerCase()
    return matchesCategory && text.includes(query.trim().toLowerCase())
  })

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const minimumReached = cartTotal >= store.minimumOrder
  const minimumProgress = Math.min(100, (cartTotal / store.minimumOrder) * 100)

  const addToCart = (product: Product) => {
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        )
      }
      return [...current, { product, quantity: 1 }]
    })
  }

  const changeQuantity = (productId: string, delta: number) => {
    setCart((current) =>
      current
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }

  const sendToWhatsApp = () => {
    if (!minimumReached || cart.length === 0) return

    const lines = cart.map(
      ({ product, quantity }) =>
        `${quantity}x ${product.name} (${product.sku}) — ${money.format(product.price * quantity)}`,
    )

    const orderCode = `AS-${Date.now().toString().slice(-6)}`
    const message = [
      `Oi, ${seller.name}! Montei este pedido na ${storeName}:`,
      '',
      ...lines,
      '',
      `Total dos produtos: ${money.format(cartTotal)}`,
      `Pedido: ${orderCode}`,
      '',
      'Pode me ajudar a finalizar?',
    ].join('\n')

    const phone = seller.phone.replace(/\D/g, '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={`app ${view === 'feed' ? 'app--feed' : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView('store')} aria-label="Voltar para a loja">
          <span className="brand__mark">AS</span>
          <span className="brand__text">
            <strong>{storeName}</strong>
            <small>via Atacado Shop</small>
          </span>
        </button>

        <nav className="view-switch" aria-label="Modo de navegação">
          <button className={view === 'store' ? 'is-active' : ''} onClick={() => setView('store')}>
            <Grid2X2 size={16} /> Loja
          </button>
          <button className={view === 'feed' ? 'is-active' : ''} onClick={() => setView('feed')}>
            <Sparkles size={16} /> Feed
          </button>
        </nav>

        <button className="cart-trigger" onClick={() => setCartOpen(true)}>
          <ShoppingBag size={19} />
          <span>Carrinho</span>
          {cartCount > 0 && <b>{cartCount}</b>}
        </button>
      </header>

      {view === 'store' ? (
        <main>
          <section className="store-intro">
            <div>
              <p className="eyebrow">{store.eyebrow}</p>
              <h1>{store.tagline}</h1>
            </div>
            <div className="seller-note">
              <span>Seu atendimento</span>
              <strong>{seller.name}</strong>
              <small>Este pedido será enviado direto para ela.</small>
            </div>
          </section>

          <section className="catalog-toolbar">
            <label className="search-box">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produto ou referência"
              />
            </label>
            <div className="minimum-inline">
              <span>Pedido mínimo</span>
              <strong>{money.format(store.minimumOrder)}</strong>
            </div>
          </section>

          <section className="category-strip" aria-label="Categorias">
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? 'is-active' : ''}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </section>

          <section className="catalog-heading">
            <div>
              <span>{visibleProducts.length} produtos</span>
              <h2>{category === 'Todos' ? 'Novidades da semana' : category}</h2>
            </div>
            <button className="feed-callout" onClick={() => setView('feed')}>
              Ver como feed <ArrowRight size={17} />
            </button>
          </section>

          <section className="product-grid">
            {visibleProducts.map((product, index) => (
              <article className="product-card" key={product.id}>
                <div className="product-card__media">
                  <img src={product.image} alt={product.name} loading={index < 4 ? 'eager' : 'lazy'} />
                  {product.featured && <span className="product-card__flag">mais pedido</span>}
                  <button className="heart-button" aria-label={`Favoritar ${product.name}`}>
                    <Heart size={18} />
                  </button>
                </div>
                <div className="product-card__content">
                  <div className="product-card__meta">
                    <span>{product.sku}</span>
                    <span>{product.category}</span>
                  </div>
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  <div className="product-card__pack">{product.pack}</div>
                  <div className="product-card__footer">
                    <strong>{money.format(product.price)}</strong>
                    <button onClick={() => addToCart(product)}>
                      <Plus size={18} /> Adicionar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {visibleProducts.length === 0 && (
            <div className="empty-state">
              <h3>Nada por aqui.</h3>
              <p>Tente buscar por outro nome, categoria ou referência.</p>
            </div>
          )}
        </main>
      ) : (
        <main className="feed-shell">
          <div className="feed-list">
            {products.map((product) => (
              <article className="feed-card" key={product.id}>
                <img src={product.image} alt={product.name} />
                <div className="feed-card__shade" />
                <div className="feed-card__top">
                  <span>{product.category}</span>
                  <span>{product.sku}</span>
                </div>
                <div className="feed-card__actions">
                  <button aria-label={`Favoritar ${product.name}`}>
                    <Heart size={22} />
                  </button>
                  <button onClick={() => addToCart(product)} aria-label={`Adicionar ${product.name}`}>
                    <Plus size={24} />
                  </button>
                </div>
                <div className="feed-card__info">
                  <span className="feed-card__seller">com {seller.name}</span>
                  <h2>{product.name}</h2>
                  <p>{product.description}</p>
                  <div className="feed-card__buyline">
                    <strong>{money.format(product.price)}</strong>
                    <button onClick={() => addToCart(product)}>
                      Adicionar ao carrinho <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {cartCount > 0 && (
            <button className="feed-cart" onClick={() => setCartOpen(true)}>
              <span>
                <ShoppingBag size={18} /> {cartCount} {cartCount === 1 ? 'item' : 'itens'}
              </span>
              <strong>{money.format(cartTotal)}</strong>
            </button>
          )}
        </main>
      )}

      <div className={`drawer-backdrop ${cartOpen ? 'is-open' : ''}`} onClick={() => setCartOpen(false)} />
      <aside className={`cart-drawer ${cartOpen ? 'is-open' : ''}`} aria-hidden={!cartOpen}>
        <div className="cart-drawer__head">
          <div>
            <small>Seu pedido</small>
            <h2>Carrinho</h2>
          </div>
          <button onClick={() => setCartOpen(false)} aria-label="Fechar carrinho">
            <X size={22} />
          </button>
        </div>

        <div className="cart-drawer__seller">
          <span>Atendimento atribuído</span>
          <strong>{seller.name}</strong>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div className="cart-empty">
              <ShoppingBag size={30} />
              <h3>Seu carrinho está vazio.</h3>
              <p>Escolha seus produtos na loja ou no feed.</p>
            </div>
          ) : (
            cart.map(({ product, quantity }) => (
              <div className="cart-item" key={product.id}>
                <img src={product.image} alt="" />
                <div className="cart-item__main">
                  <span>{product.sku}</span>
                  <strong>{product.name}</strong>
                  <small>{money.format(product.price)} cada</small>
                </div>
                <div className="quantity-control">
                  <button onClick={() => changeQuantity(product.id, -1)} aria-label="Diminuir quantidade">
                    <Minus size={14} />
                  </button>
                  <b>{quantity}</b>
                  <button onClick={() => changeQuantity(product.id, 1)} aria-label="Aumentar quantidade">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cart-drawer__foot">
          <div className="minimum-box">
            <div className="minimum-box__copy">
              {minimumReached ? (
                <span className="minimum-ok"><Check size={15} /> Pedido mínimo atingido</span>
              ) : (
                <span>Faltam {money.format(Math.max(0, store.minimumOrder - cartTotal))} para o mínimo</span>
              )}
              <strong>{money.format(cartTotal)} / {money.format(store.minimumOrder)}</strong>
            </div>
            <div className="minimum-track">
              <span style={{ width: `${minimumProgress}%` }} />
            </div>
          </div>

          <div className="cart-total">
            <span>Total dos produtos</span>
            <strong>{money.format(cartTotal)}</strong>
          </div>

          <button className="whatsapp-button" disabled={!minimumReached || cart.length === 0} onClick={sendToWhatsApp}>
            Enviar pedido para {seller.name}
            <ArrowRight size={19} />
          </button>
          <p className="checkout-note">Você finaliza pagamento, frete e detalhes direto no WhatsApp.</p>
        </div>
      </aside>

      {view === 'store' && (
        <button className="mobile-cart" onClick={() => setCartOpen(true)}>
          <ShoppingBag size={18} />
          <span>{cartCount > 0 ? `${cartCount} itens · ${money.format(cartTotal)}` : 'Ver carrinho'}</span>
          <ArrowLeft className="mobile-cart__arrow" size={17} />
        </button>
      )}
    </div>
  )
}

export default App
