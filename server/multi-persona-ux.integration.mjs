import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const unique = Date.now() + '-' + Math.random().toString(16).slice(2)
const shops = []
const assignments = [0, 0, 1, 1, 2]
const requests = []

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(base + path, {
    method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean)
  return {
    status: response.status, data, headers: response.headers,
    cookie: cookies.map(c => String(c).split(';')[0])
      .find(c => c.startsWith('atacado_session=') || c.startsWith('shopvax_customer_session=')) || '',
  }
}
function expectOk(result, status, step) {
  assert.equal(result.status, status, step + ': ' + JSON.stringify(result.data))
}
try {
  for (let i = 0; i < 3; i++) {
    const owner = await request('/api/auth/register', { method: 'POST', body: {
      name: 'Proprietário ' + i, email: 'ux-owner-' + i + '-' + unique + '@example.test',
      password: 'ux-owner-secure-1234', storeName: 'Loja Multiperfil ' + i + ' ' + unique,
      whatsapp: '5511999999999', planCode: 'bronze',
    } })
    expectOk(owner, 201, 'Cadastro lojista ' + i)
    assert(owner.cookie.startsWith('atacado_session='))
    const slug = owner.data.storeSlug
    const seller = await request('/api/admin/sellers', { method: 'POST', cookie: owner.cookie,
      body: { name: 'Atendente ' + i, phone: '551198888000' + i, isActive: true } })
    expectOk(seller, 201, 'Vendedora ' + i)
    const product = await request('/api/admin/products', { method: 'POST', cookie: owner.cookie,
      body: { sku: 'UX-' + i + '-' + unique, name: 'Produto da loja ' + i,
        price: 100 + i * 20, category: 'Simulação', description: '',
        mediaUrl: '', mediaType: 'image', pack: '', variations: [], active: true } })
    expectOk(product, 201, 'Produto ' + i)
    shops.push({ slug, ownerCookie: owner.cookie, productId: product.data.product.id,
      sellerPhone: '551198888000' + i, createdOrders: [] })
  }

  for (let i = 0; i < assignments.length; i++) {
    const tenant = assignments[i]
    const shop = shops[tenant]
    const buyer = await request('/api/public/store/' + shop.slug + '/customers/register', {
      method: 'POST', body: {
        name: 'Comprador Simulado ' + i,
        email: 'ux-buyer-' + i + '-' + unique + '@example.test',
        phone: '5511998000' + String(i).padStart(3, '0'),
        password: 'ux-buyer-secure-1234',
      },
    })
    expectOk(buyer, 201, 'Cadastro comprador ' + i)
    assert(buyer.cookie.startsWith('shopvax_customer_session='))
    const ownAccount = await request('/api/public/store/' + shop.slug + '/customers/me',
      { cookie: buyer.cookie })
    expectOk(ownAccount, 200, 'Conta correta ' + i)
    for (let other = 0; other < shops.length; other++) {
      if (other === tenant) continue
      const foreign = await request('/api/public/store/' + shops[other].slug + '/customers/me',
        { cookie: buyer.cookie })
      assert.equal(foreign.status, 401, 'Conta de comprador ' + i + ' acessou loja ' + other)
    }
    const order = await request('/api/business/orders', { method: 'POST', cookie: buyer.cookie,
      body: { storeSlug: shop.slug,
        items: [{ productId: shop.productId, quantity: 1, selections: {} }] },
    })
    expectOk(order, 201, 'Pedido do comprador ' + i)
    assert.equal(new URL(order.data.whatsappUrl).hostname, 'wa.me')
    assert.equal(new URL(order.data.whatsappUrl).pathname, '/' + shop.sellerPhone,
      'O pedido foi direcionado para telefone de outra loja.')
    assert.ok(order.data.orderId)
    shop.createdOrders.push(order.data.orderId)
    const history = await request('/api/public/store/' + shop.slug + '/customers/me',
      { cookie: buyer.cookie })
    expectOk(history, 200, 'Histórico comprador ' + i)
    assert.deepEqual(history.data.orders.map(item => item.id), [order.data.orderId],
      'Comprador recebeu histórico de outro usuário')
    assert.equal(history.data.orders[0].status, 'whatsapp',
      'Clique/abertura do WhatsApp nunca deve contar como venda confirmada')
    requests.push({ buyer: i, store: tenant, order: order.data.orderId })
  }
  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i]
    const dashboard = await request('/api/admin/phase2', { cookie: shop.ownerCookie })
    expectOk(dashboard, 200, 'Painel do lojista ' + i)
    const orders = dashboard.data.orders || []
    assert.deepEqual(
      orders.map(order => order.id).filter(id => shop.createdOrders.includes(id)).sort(),
      shop.createdOrders.slice().sort(),
      'Pedidos próprios ausentes do painel ' + i,
    )
    for (let other = 0; other < shops.length; other++) {
      if (i === other) continue
      assert(!orders.some(order => shops[other].createdOrders.includes(order.id)),
        'Painel ' + i + ' exibiu pedidos da loja ' + other)
    }
  }
  const cross = await request('/api/business/orders', { method: 'POST', body: {
    storeSlug: shops[1].slug, items: [{ productId: shops[0].productId, quantity: 1, selections: {} }],
  } })
  assert.notEqual(cross.status, 201, 'Produto da Loja 0 aceito em pedido da Loja 1')
  console.log('SHOPVAX_MULTI_PERSONA_API_PASS ' + JSON.stringify({
    stores: shops.length, buyers: assignments.length, orders: requests.length,
    crossTenantReadBlocked: true, foreignProductRejected: true,
  }))
} catch (error) {
  console.error('SHOPVAX_MULTI_PERSONA_API_FAIL', error)
  process.exitCode = 1
}
