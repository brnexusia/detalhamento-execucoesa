import express from 'express'
import pg from 'pg'

// All SEO routes are evaluated from current public database state. No sample URLs.
const SITE = 'https://shopvax.com.br'
const PAGE_SIZE = 10000
const pool = process.env.DATABASE_URL?.trim()
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL.trim(), max: 2, connectionTimeoutMillis: 3000 })
  : null
if (pool) pool.on('error', (err) => console.error('[seo] database:', err.message))

export const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export const canonicalUrl = (pathname, search = '') => SITE + pathname + search
export const isPositivePage = (value) => /^[1-9]\d{0,5}$/.test(String(value))
export function urlset(rows) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map((item) => '  <url><loc>' + xmlEscape(item.url) + '</loc>' +
      (item.modified ? '<lastmod>' + xmlEscape(new Date(item.modified).toISOString()) + '</lastmod>' : '') +
      '</url>').join('\n') + '\n</urlset>'
}
export function sitemapIndex(urls) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((url) => '  <sitemap><loc>' + xmlEscape(url) + '</loc></sitemap>').join('\n') +
    '\n</sitemapindex>'
}
const protect = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res)).catch((err) => {
    console.error('[seo] sitemap unavailable:', err.message)
    if (!res.headersSent) res.status(503).type('text/plain').send('Sitemap temporarily unavailable.')
  })
const xml = (res, body) => res.set('Cache-Control', 'no-store')
  .set('X-Content-Type-Options', 'nosniff')
  .type('application/xml').send(body)

function installSeo(app) {
  if (app.__shopvaxSeoInstalled) return
  app.__shopvaxSeoInstalled = true
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase()
    if (host === 'www.shopvax.com.br' && (req.method === 'GET' || req.method === 'HEAD')) {
      return res.redirect(308, SITE + req.originalUrl)
    }
    if (/^\/(?:api|painel|admin|cliente|comprador)(?:\/|$)/.test(req.path) ||
        /^\/(?:entrar|login|criar-conta)(?:\/|$)/.test(req.path)) {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    }
    next()
  })
  // Register before the legacy protection hook, which previously returned a minimal robots.txt.
  app.get('/robots.txt', (_req, res) => res.type('text/plain').set('Cache-Control', 'no-store').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /painel',
    'Disallow: /admin',
    'Disallow: /cliente',
    'Disallow: /comprador',
    'Disallow: /entrar',
    'Disallow: /login',
    'Disallow: /criar-conta',
    'Sitemap: ' + SITE + '/sitemap.xml',
    '',
  ].join('\n')))

  app.get('/sitemap.xml', protect(async (_req, res) => {
    if (!pool) return res.status(503).end()
    const result = await pool.query([
      'SELECT (SELECT count(*)::int FROM stores WHERE is_active=true)',
      '+ (SELECT count(*)::int FROM stores WHERE is_active=true AND social_enabled=true) AS store_urls,',
      '(SELECT count(*)::int FROM products p',
      'JOIN stores s ON s.id=p.store_id AND s.is_active=true',
      'WHERE p.active=true AND EXISTS (',
      'SELECT 1 FROM catalogs c LEFT JOIN catalog_products cp',
      'ON cp.catalog_id=c.id AND cp.product_id=p.id',
      'WHERE c.store_id=s.id AND c.is_default=true AND c.active=true',
      'AND COALESCE(cp.visible,true)=true)) AS product_urls',
    ].join(' '))
    const row = result.rows[0]
    const sCount = Math.ceil(Number(row.store_urls) / PAGE_SIZE)
    const pCount = Math.ceil(Number(row.product_urls) / PAGE_SIZE)
    const urls = [SITE + '/sitemap-pages.xml']
    for (let i = 1; i <= sCount; i++) urls.push(SITE + '/sitemap-stores-' + i + '.xml')
    for (let i = 1; i <= pCount; i++) urls.push(SITE + '/sitemap-products-' + i + '.xml')
    return xml(res, sitemapIndex(urls))
  }))

  app.get('/sitemap-pages.xml', (_req, res) => xml(res, urlset([
    { url: SITE + '/' }, { url: SITE + '/para-lojas' },
  ])))

  app.get('/sitemap-stores-:page.xml', protect(async (req, res) => {
    if (!pool) return res.status(503).end()
    if (!isPositivePage(req.params.page)) return res.status(404).end()
    const offset = (Number(req.params.page) - 1) * PAGE_SIZE
    const rows = await pool.query([
      'SELECT slug, profile, updated_at FROM (',
      'SELECT slug,false AS profile,updated_at FROM stores WHERE is_active=true',
      'UNION ALL',
      'SELECT slug,true AS profile,updated_at FROM stores WHERE is_active=true AND social_enabled=true',
      ') public_urls ORDER BY slug,profile LIMIT $1 OFFSET $2',
    ].join(' '), [PAGE_SIZE, offset])
    if (!rows.rowCount) return res.status(404).end()
    return xml(res, urlset(rows.rows.map((row) => ({
      url: SITE + (row.profile ? '/perfil/' : '/') + encodeURIComponent(row.slug),
      modified: row.updated_at,
    }))))
  }))

  app.get('/sitemap-products-:page.xml', protect(async (req, res) => {
    if (!pool) return res.status(503).end()
    if (!isPositivePage(req.params.page)) return res.status(404).end()
    const offset = (Number(req.params.page) - 1) * PAGE_SIZE
    const rows = await pool.query([
      'SELECT s.slug,p.id,p.updated_at FROM products p',
      'JOIN stores s ON s.id=p.store_id AND s.is_active=true',
      'WHERE p.active=true AND EXISTS (',
      'SELECT 1 FROM catalogs c LEFT JOIN catalog_products cp',
      'ON cp.catalog_id=c.id AND cp.product_id=p.id',
      'WHERE c.store_id=s.id AND c.is_default=true AND c.active=true',
      'AND COALESCE(cp.visible,true)=true)',
      'ORDER BY s.slug,p.id LIMIT $1 OFFSET $2',
    ].join(' '), [PAGE_SIZE, offset])
    if (!rows.rowCount) return res.status(404).end()
    return xml(res, urlset(rows.rows.map((row) => ({
      url: SITE + '/' + encodeURIComponent(row.slug) + '?produto=' + encodeURIComponent(row.id),
      modified: row.updated_at,
    }))))
  }))
}
const originalInit = express.application.init
express.application.init = function shopvaxSeoInit(...args) {
  const result = originalInit.apply(this, args)
  installSeo(this)
  return result
}
