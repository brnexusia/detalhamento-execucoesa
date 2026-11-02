import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 3000 }) : null
const htmlCache = new Map()
const reserved = new Set(['feed', 'descobrir', 'para-lojas', 'entrar', 'criar-conta', 'painel', 'admin', 'api', 'media', 'assets', 'health', 'robots.txt'])

if (pool) pool.on('error', (error) => console.error('[page metadata] pool:', error.message))

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function originFor(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim()
  return `${proto}://${host}`
}

function absoluteUrl(req, value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw, originFor(req))
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch { return '' }
}

const SITE = 'https://shopvax.com.br'
const NON_PUBLIC = new Set([
  'feed','descobrir','para-lojas','entrar','login','criar-conta','comprador',
  'cliente','painel','admin','api','media','assets','health','robots.txt','sitemap.xml',
  'perfil','favicon.svg'
])
const plain = (value, fallback = '') => String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 220)
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
const documentUrl = (path, query = '') => SITE + path + query
const publicImage = (value) => {
  try {
    const u = new URL(String(value || ''), SITE)
    return u.protocol === 'https:' && (u.hostname === 'shopvax.com.br' || u.hostname.endsWith('.shopvax.com.br'))
      ? u.href : ''
  } catch { return '' }
}
const base = (status = 200) => ({
  title: 'Shopvax | Catálogos, lojas e compras pelo WhatsApp',
  description: 'Descubra lojas, explore produtos e organize pedidos diretamente pelo WhatsApp no Shopvax.',
  url: SITE + '/', status, index: status === 200, image: '', schema: null, headline: '', excerpt: '',
})
async function metadataFor(req) {
  const url = new URL(req.originalUrl || '/', SITE)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const parts = pathname.split('/').filter(Boolean)
  const params = [...url.searchParams.keys()]
  const productId = String(url.searchParams.get('produto') || '').trim().slice(0, 100)
  const cleanQuery = params.length === 0 || (params.length === 1 && params[0] === 'produto' && productId)
  const meta = base()
  meta.url = documentUrl(pathname)
  if (pathname === '/') {
    meta.url = SITE + '/'
    meta.headline = 'Descubra lojas e produtos no Shopvax'
    return meta
  }
  if (pathname === '/para-lojas') {
    meta.title = 'Catálogo digital para atacado e varejo | Shopvax'
    meta.description = 'Organize produtos, catálogos e vendedoras; seus clientes escolhem os itens e enviam o pedido pelo WhatsApp.'
    meta.headline = 'Seu catálogo digital com pedidos pelo WhatsApp'
    meta.excerpt = meta.description
    return meta
  }
  if (parts[0] === 'perfil' && parts.length !== 2) return { ...meta, status: 404, index: false }
  const profile = parts[0] === 'perfil' && parts.length === 2
  const storeSlug = profile ? parts[1] : parts[0]
  if (!pool || !storeSlug || NON_PUBLIC.has(storeSlug) || (!profile && parts.length > 2)) {
    return { ...meta, index: false, status: pool ? 200 : 503 }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(storeSlug)) return { ...meta, status: 404, index: false }
  try {
    const stores = await pool.query(
      'SELECT id,slug,name,tagline,logo_url,social_enabled FROM stores WHERE slug=$1 AND is_active=true LIMIT 1',
      [storeSlug],
    )
    if (!stores.rowCount || (profile && stores.rows[0].social_enabled !== true)) {
      return { ...meta, status: 404, index: false }
    }
    const store = stores.rows[0]
    const canonicalPath = (profile ? '/perfil/' : '/') + encodeURIComponent(store.slug)
    meta.url = documentUrl(canonicalPath)
    meta.title = plain(store.name) + (profile ? ' — Perfil | Shopvax' : ' — Catálogo | Shopvax')
    meta.description = plain(store.tagline, 'Explore o catálogo de ' + store.name + ' no Shopvax.')
    meta.image = publicImage(store.logo_url)
    meta.headline = plain(store.name)
    meta.excerpt = meta.description
    meta.index = cleanQuery && (profile || parts.length === 1)
    meta.schema = {
      '@context': 'https://schema.org', '@type': 'Store',
      name: plain(store.name), url: meta.url,
      ...(meta.image ? { image: meta.image } : {}),
    }
    if (productId) {
      if (!cleanQuery || parts.length !== (profile ? 2 : 1)) return { ...meta, index: false }
      const found = await pool.query([
        'SELECT p.id,p.name,p.description,p.media_type,p.media_url',
        'FROM products p',
        'JOIN catalogs c ON c.store_id=p.store_id AND c.is_default=true AND c.active=true',
        'LEFT JOIN catalog_products cp ON cp.catalog_id=c.id AND cp.product_id=p.id',
        'WHERE p.id=$1 AND p.store_id=$2 AND p.active=true AND COALESCE(cp.visible,true)=true',
        'LIMIT 1',
      ].join(' '), [productId, store.id])
      if (!found.rowCount) return { ...meta, status: 404, index: false, schema: null }
      const product = found.rows[0]
      const canonicalProduct = documentUrl('/' + encodeURIComponent(store.slug), '?produto=' + encodeURIComponent(product.id))
      meta.url = canonicalProduct
      meta.title = plain(product.name) + ' | ' + plain(store.name) + ' · Shopvax'
      meta.description = plain(product.description, 'Conheça ' + product.name + ' no catálogo da loja ' + store.name + '.')
      meta.image = product.media_type === 'image' ? (publicImage(product.media_url) || meta.image) : meta.image
      meta.headline = plain(product.name)
      meta.excerpt = meta.description
      meta.index = !profile && cleanQuery
      meta.schema = {
        '@context': 'https://schema.org', '@type': 'Product',
        name: plain(product.name), description: meta.description, url: canonicalProduct,
        ...(meta.image ? { image: meta.image } : {}),
        isPartOf: { '@type': 'WebPage', name: plain(store.name), url: documentUrl('/' + encodeURIComponent(store.slug)) },
      }
    }
    return meta
  } catch (error) {
    console.error('[seo] metadata lookup failed:', error instanceof Error ? error.message : String(error))
    return { ...base(503), index: false, url: SITE + pathname }
  }
}

function injectMetadata(html, meta) {
  const esc = escapeHtml
  const description = esc(meta.description)
  const title = esc(meta.title)
  const url = esc(meta.url)
  const image = meta.image ? esc(meta.image) : ''
  const tags = [
    '<link rel="canonical" href="' + url + '" />',
    '<meta name="robots" content="' + (meta.index && meta.status === 200 ? 'index,follow,max-image-preview:large' : 'noindex,nofollow,noarchive') + '" />',
    '<meta property="og:site_name" content="Shopvax" />',
    '<meta property="og:locale" content="pt_BR" />',
    '<meta property="og:type" content="' + (meta.schema?.['@type'] === 'Product' ? 'product' : 'website') + '" />',
    '<meta property="og:title" content="' + title + '" />',
    '<meta property="og:description" content="' + description + '" />',
    '<meta property="og:url" content="' + url + '" />',
    '<meta name="twitter:card" content="' + (image ? 'summary_large_image' : 'summary') + '" />',
    '<meta name="twitter:title" content="' + title + '" />',
    '<meta name="twitter:description" content="' + description + '" />',
  ]
  if (image) {
    tags.push('<meta property="og:image" content="' + image + '" />')
    tags.push('<meta name="twitter:image" content="' + image + '" />')
  }
  const organization = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: 'Shopvax', url: SITE, logo: SITE + '/brand/shopvax-lockup.svg',
  }
  const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Shopvax', url: SITE + '/', inLanguage: 'pt-BR' }
  if (meta.url === SITE + '/' || meta.url === SITE + '/para-lojas') {
    tags.push('<script type="application/ld+json">' + safeJson([organization, website]) + '</script>')
  } else if (meta.schema && meta.index) {
    tags.push('<script type="application/ld+json">' + safeJson(meta.schema) + '</script>')
  }
  let result = html.replace(/<title>[^<]*<\/title>/i, '<title>' + title + '</title>')
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, '<meta name="description" content="' + description + '" />')
    .replace('</head>', '    ' + tags.join('\n    ') + '\n  </head>')
  // Real server response content for crawlers; React replaces this boot markup when mounted.
  // Same content is presented to visitors and bots; no UA-specific rendering or hidden text.
  if (meta.index && meta.headline) {
    const fallback = '<main class="shopvax-seo-boot" style="max-width:64rem;margin:auto;padding:3rem 1.5rem">' +
      '<h1>' + esc(meta.headline) + '</h1>' +
      (meta.excerpt ? '<p>' + esc(meta.excerpt) + '</p>' : '') +
      '</main>'
    result = result.replace('<div id="root"></div>', '<div id="root">' + fallback + '</div>')
  }
  return result
}

const originalSendFile = express.response.sendFile
express.response.sendFile = function metadataSendFile(filePath, options, callback) {
  const absolutePath = path.resolve(String(filePath || ''))
  if (path.basename(absolutePath) !== 'index.html' || !this.req || this.headersSent) {
    return originalSendFile.call(this, filePath, options, callback)
  }

  const res = this
  // HTML precisa ser revalidado após cada deploy, inclusive no Safari iOS.
  // Assets com hash podem continuar com cache longo e imutável.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  Promise.all([
    htmlCache.has(absolutePath)
      ? Promise.resolve(htmlCache.get(absolutePath))
      : fs.readFile(absolutePath, 'utf8').then((html) => { htmlCache.set(absolutePath, html); return html }),
    metadataFor(res.req),
  ]).then(([html, meta]) => {
    if (res.headersSent) return
    res.setHeader('X-Robots-Tag', meta.index && meta.status === 200 ? 'index,follow' : 'noindex,nofollow,noarchive')
    res.status(meta.status || 200).type('html').send(injectMetadata(html, meta))
    if (typeof callback === 'function') callback(null)
  }).catch((error) => {
    console.error('[page metadata] fallback:', error instanceof Error ? error.message : String(error))
    originalSendFile.call(res, filePath, options, (sendError) => {
      if (typeof callback === 'function') callback(sendError || null)
      else if (sendError && !res.headersSent) res.status(sendError.statusCode || 500).end()
    })
  })

  return res
}
