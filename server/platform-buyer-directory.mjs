// Directory of registered buyers for platform administrators only.
// No phone/email matching or inference for anonymous orders.
export function registerPlatformBuyerDirectory(router, requireAdmin, asyncRoute, pool) {
  const numeric = (value) => Number(value || 0)
  const flag = (value) => value === true
  const clamp = (value, fallback, min, max) => {
    const n = Number(value)
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  async function capabilities() {
    const result = await pool.query(
      "SELECT to_regclass('public.buyer_accounts') AS buyers, to_regclass('public.store_customers') AS customers, " +
      "to_regclass('public.buyer_account_origins') AS origins, to_regclass('public.shopvax_growth_consents') AS consents"
    )
    const found = result.rows[0] || {}
    const columns = await pool.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' " +
      "AND ((table_name='store_customers' AND column_name='buyer_account_id') OR (table_name='orders' AND column_name='customer_id'))"
    )
    const names = new Set(columns.rows.map((row) => row.table_name + '.' + row.column_name))
    return {
      buyers: Boolean(found.buyers),
      customers: Boolean(found.customers),
      origins: Boolean(found.origins),
      consents: Boolean(found.consents),
      linkedBuyers: names.has('store_customers.buyer_account_id'),
      orderCustomers: names.has('orders.customer_id'),
    }
  }

  function directory(caps) {
    const sources = []
    if (caps.buyers) {
      const origin = caps.origins
        ? "(SELECT s.name FROM buyer_account_origins a JOIN stores s ON s.id=a.store_id WHERE a.buyer_id=b.id LIMIT 1)"
        : "NULL::text"
      sources.push(
        "SELECT 'global'::text AS source,b.id,b.name,b.email,b.phone,b.created_at," +
        "b.profile_completed,b.marketing_consent,b.city,b.state,b.purpose,b.business_status," +
        "b.business_name,b.cnpj,b.cnpj_status,b.segment,b.instagram,b.channels," +
        origin + " AS origin_name FROM buyer_accounts b"
      )
    }
    if (caps.customers) {
      sources.push(
        "SELECT 'legacy'::text AS source,c.id,c.name,c.email,c.phone,c.created_at," +
        "true AS profile_completed,NULL::boolean AS marketing_consent,''::text AS city,''::text AS state," +
        "''::text AS purpose,''::text AS business_status,''::text AS business_name,''::text AS cnpj," +
        "''::text AS cnpj_status,''::text AS segment,''::text AS instagram,'[]'::jsonb AS channels," +
        "s.name AS origin_name FROM store_customers c JOIN stores s ON s.id=c.store_id " +
        (caps.linkedBuyers ? "WHERE c.buyer_account_id IS NULL" : "")
      )
    }
    return sources.length ? sources.join(" UNION ALL ") : null
  }

  function customerMatch(caps, alias) {
    if (!caps.customers) return 'false'
    const linked = caps.linkedBuyers ? "(" + alias + ".source='global' AND c.buyer_account_id=" + alias + ".id)" : 'false'
    return "(" + linked + " OR (" + alias + ".source='legacy' AND c.id=" + alias + ".id))"
  }

  router.get('/buyers', requireAdmin, asyncRoute(async (req, res) => {
    const caps = await capabilities()
    const union = directory(caps)
    const limit = clamp(req.query.limit, 25, 1, 100)
    const offset = clamp(req.query.offset, 0, 0, 1000000)
    const q = String(req.query.q || '').trim().slice(0, 120)
    const source = ['global', 'legacy'].includes(req.query.source) ? req.query.source : 'all'
    res.set('Cache-Control', 'private, no-store')
    if (!union) return res.json({ buyers: [], total: 0, limit, offset, coverage: caps })
    const filter = "($1='' OR COALESCE(d.name,'') ILIKE '%'||$1||'%' OR " +
      "COALESCE(d.email,'') ILIKE '%'||$1||'%' OR COALESCE(d.phone,'') ILIKE '%'||$1||'%') " +
      "AND ($2='all' OR d.source=$2)"
    const total = await pool.query(
      "WITH directory AS (" + union + ") SELECT count(*)::int AS total FROM directory d WHERE " + filter,
      [q, source]
    )
    const linked = customerMatch(caps, 'p')
    const orderStats = caps.orderCustomers && caps.customers
      ? "LEFT JOIN LATERAL (SELECT count(*)::int AS orders_count, " +
        "count(*) FILTER (WHERE o.status<>'cancelled')::int AS valid_orders, " +
        "COALESCE(sum(o.total) FILTER (WHERE o.status<>'cancelled'),0)::numeric AS orders_value, " +
        "max(o.created_at) AS last_order_at FROM orders o JOIN store_customers c " +
        "ON c.id=o.customer_id AND c.store_id=o.store_id WHERE " + linked + ") o ON true "
      : "LEFT JOIN LATERAL (SELECT 0::int AS orders_count,0::int AS valid_orders,0::numeric AS orders_value,NULL::timestamptz AS last_order_at) o ON true "
    const storeStats = caps.customers
      ? "LEFT JOIN LATERAL (SELECT count(DISTINCT c.store_id)::int AS stores_count " +
        "FROM store_customers c WHERE " + linked + ") link ON true"
      : "LEFT JOIN LATERAL (SELECT 0::int AS stores_count) link ON true"
    const rows = await pool.query(
      "WITH directory AS (" + union + ") " +
      "SELECT p.source,p.id,p.name,p.email,p.phone,p.created_at,p.profile_completed,p.marketing_consent,p.origin_name," +
      "o.orders_count,o.valid_orders,o.orders_value,o.last_order_at,link.stores_count " +
      "FROM (SELECT d.* FROM directory d WHERE " + filter +
      " ORDER BY d.created_at DESC,d.id DESC LIMIT $3 OFFSET $4) p " +
      orderStats + storeStats + " ORDER BY p.created_at DESC,p.id DESC",
      [q, source, limit, offset]
    )
    return res.json({
      total: numeric(total.rows[0]?.total), limit, offset, coverage: caps,
      buyers: rows.rows.map((row) => ({
        source: row.source, id: row.id, name: row.name, email: row.email, phone: row.phone,
        createdAt: row.created_at, profileCompleted: flag(row.profile_completed),
        marketingConsent: row.marketing_consent == null ? null : flag(row.marketing_consent),
        originName: row.origin_name, ordersCount: numeric(row.orders_count), validOrders: numeric(row.valid_orders),
        ordersValue: numeric(row.orders_value), lastOrderAt: row.last_order_at,
        storesCount: numeric(row.stores_count),
      })),
    })
  }))

  router.get('/buyers/:source/:buyerId', requireAdmin, asyncRoute(async (req, res) => {
    const caps = await capabilities()
    const union = directory(caps)
    const source = req.params.source
    const buyerId = String(req.params.buyerId || '').slice(0, 160)
    if (!['global', 'legacy'].includes(source) || !buyerId || !union) {
      return res.status(404).json({ error: 'Comprador não encontrado.' })
    }
    const record = await pool.query(
      "WITH directory AS (" + union + ") SELECT * FROM directory d WHERE d.source=$1 AND d.id=$2 LIMIT 1",
      [source, buyerId]
    )
    if (!record.rowCount) return res.status(404).json({ error: 'Comprador não encontrado.' })
    const p = record.rows[0]
    const match = customerMatch(caps, 'd')
    const condition = "d.source=$1 AND d.id=$2"
    const cte = "WITH directory AS (" + union + "), chosen AS (SELECT * FROM directory d WHERE " + condition + ") "
    let stores = []
    if (caps.customers) {
      const consentCols = caps.consents
        ? "COALESCE(bool_or(consent.whatsapp),false) AS promo_whatsapp," +
          "COALESCE(bool_or(consent.email),false) AS promo_email,"
        : "false AS promo_whatsapp,false AS promo_email,"
      const consentJoin = caps.consents
        ? "LEFT JOIN shopvax_growth_consents consent ON consent.customer_id=c.id AND consent.home_store_id=c.store_id "
        : ''
      const ordersJoin = caps.orderCustomers
        ? "LEFT JOIN orders o ON o.customer_id=c.id AND o.store_id=c.store_id "
        : ''
      const counts = caps.orderCustomers
        ? "count(DISTINCT o.id)::int AS orders_count," +
          "COALESCE(sum(o.total) FILTER (WHERE o.status<>'cancelled'),0)::numeric AS orders_value," +
          "max(o.created_at) AS last_order_at "
        : "0::int AS orders_count,0::numeric AS orders_value,NULL::timestamptz AS last_order_at "
      const query = cte +
        "SELECT s.id,s.name,s.slug,min(c.created_at) AS linked_at," + consentCols + counts +
        "FROM chosen d JOIN store_customers c ON " + match +
        " JOIN stores s ON s.id=c.store_id " + ordersJoin + consentJoin +
        "GROUP BY s.id,s.name,s.slug ORDER BY orders_count DESC,s.name ASC"
      const result = await pool.query(query, [source, buyerId])
      stores = result.rows.map((row) => ({
        id: row.id, name: row.name, slug: row.slug, linkedAt: row.linked_at,
        ordersCount: numeric(row.orders_count), ordersValue: numeric(row.orders_value),
        lastOrderAt: row.last_order_at, promoWhatsapp: flag(row.promo_whatsapp),
        promoEmail: flag(row.promo_email),
      }))
    }
    let orders = []
    let totals = {
      ordersCount: 0, validOrders: 0, cancelledOrders: 0, ordersValue: 0,
      averageTicket: 0, firstOrderAt: null, lastOrderAt: null, last30Days: 0, last90Days: 0,
    }
    if (caps.customers && caps.orderCustomers) {
      const from =
        "FROM chosen d JOIN store_customers c ON " + match +
        " JOIN orders o ON o.customer_id=c.id AND o.store_id=c.store_id JOIN stores s ON s.id=o.store_id "
      const aggregate = await pool.query(
        "WITH summary AS (" + cte +
        "SELECT count(*)::int AS orders_count," +
        "count(*) FILTER (WHERE o.status<>'cancelled')::int AS valid_orders," +
        "count(*) FILTER (WHERE o.status='cancelled')::int AS cancelled_orders," +
        "COALESCE(sum(o.total) FILTER (WHERE o.status<>'cancelled'),0)::numeric AS orders_value," +
        "COALESCE(avg(o.total) FILTER (WHERE o.status<>'cancelled'),0)::numeric AS average_ticket," +
        "min(o.created_at) FILTER (WHERE o.status<>'cancelled') AS first_order_at," +
        "max(o.created_at) FILTER (WHERE o.status<>'cancelled') AS last_order_at," +
        "count(*) FILTER (WHERE o.status<>'cancelled' AND o.created_at>=now()-interval '30 days')::int AS last_30_days," +
        "count(*) FILTER (WHERE o.status<>'cancelled' AND o.created_at>=now()-interval '90 days')::int AS last_90_days " +
        from + ") SELECT * FROM summary",
        [source, buyerId]
      )
      const x = aggregate.rows[0] || {}
      totals = {
        ordersCount: numeric(x.orders_count), validOrders: numeric(x.valid_orders),
        cancelledOrders: numeric(x.cancelled_orders), ordersValue: numeric(x.orders_value),
        averageTicket: numeric(x.average_ticket), firstOrderAt: x.first_order_at || null,
        lastOrderAt: x.last_order_at || null,
        last30Days: numeric(x.last_30_days), last90Days: numeric(x.last_90_days),
      }
      const recent = await pool.query(
        cte + "SELECT o.id,o.code,o.status,o.total,o.created_at,s.name AS store_name,s.slug AS store_slug " +
        from + " ORDER BY o.created_at DESC,o.id DESC LIMIT 100",
        [source, buyerId]
      )
      orders = recent.rows.map((row) => ({
        id: row.id, code: row.code, status: row.status, total: numeric(row.total),
        createdAt: row.created_at, storeName: row.store_name, storeSlug: row.store_slug,
      }))
    }
    const gap = totals.validOrders > 1 && totals.firstOrderAt && totals.lastOrderAt
      ? (new Date(totals.lastOrderAt).getTime() - new Date(totals.firstOrderAt).getTime()) / 86400000 / (totals.validOrders - 1)
      : null
    res.set('Cache-Control', 'private, no-store')
    return res.json({
      profile: {
        source: p.source, id: p.id, name: p.name, email: p.email, phone: p.phone,
        createdAt: p.created_at, profileCompleted: flag(p.profile_completed),
        marketingConsent: p.marketing_consent == null ? null : flag(p.marketing_consent),
        city: p.city, state: p.state, purpose: p.purpose, businessStatus: p.business_status,
        businessName: p.business_name, cnpj: p.cnpj, cnpjStatus: p.cnpj_status,
        segment: p.segment, instagram: p.instagram, channels: p.channels || [], originName: p.origin_name,
      },
      stores, orders, summary: {
        ...totals, storesCount: stores.length,
        averageDaysBetweenOrders: gap == null ? null : Math.round(gap * 10) / 10,
      },
      coverage: caps,
      semantics: 'Pedidos e valores correspondem a pedidos registrados, não a pagamentos ou vendas confirmadas. Somente vínculos explícitos entram no histórico.',
    })
  }))
}
