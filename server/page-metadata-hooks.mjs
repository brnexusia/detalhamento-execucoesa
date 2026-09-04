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

async function metadataFor(req) {
  const origin = originFor(req)
  const url = new URL(req.originalUrl || req.url || '/', origin)
  const segments = url.pathname.split('/').filter(Boolean)
  const isProfile = segments[0] === 'perfil'
  const slug = isProfile ? segments[1] || '' : segments[0] || ''
  const canonicalUrl = `${origin}${url.pathname}${url.search}`
  const fallback = {
    title: 'Shopvax',
    description: 'Shopvax — descubra produtos e lojas e monte seu pedido direto pelo WhatsApp.',
    url: canonicalUrl,
    image: '',
    video: '',
  }

  if (!pool || !slug || (!isProfile && reserved.has(slug))) return fallback

  try {
    const storeResult = await pool.query(
      'SELECT id,slug,name,tagline,logo_url FROM stores WHERE slug=$1 AND is_active=true LIMIT 1',
      [slug],
    )
    if (!storeResult.rowCount) return fallback
    const store = storeResult.rows[0]
    const productId = String(url.searchParams.get('produto') || '').trim().slice(0, 100)

    if (productId) {
      const productResult = await pool.query(
        `SELECT id,name,description,media_url,media_type
         FROM products WHERE id=$1 AND store_id=$2 AND active=true LIMIT 1`,
        [productId, store.id],
      )
      if (productResult.rowCount) {
        const product = productResult.rows[0]
        return {
          title: `${product.name} · ${store.name} | Shopvax`,
          description: String(product.description || `Veja ${product.name} no perfil da ${store.name} no Shopvax.`).slice(0, 220),
          url: canonicalUrl,
          image: product.media_type === 'image' ? absoluteUrl(req, product.media_url) : absoluteUrl(req, store.logo_url),
          video: product.media_type === 'video' ? absoluteUrl(req, product.media_url) : '',
        }
      }
    }

    return {
      title: `${store.name} | Shopvax`,
      description: String(store.tagline || `Veja o perfil da ${store.name} no Shopvax.`).slice(0, 220),
      url: canonicalUrl,
      image: absoluteUrl(req, store.logo_url),
      video: '',
    }
  } catch (error) {
    console.error('[page metadata] lookup:', error instanceof Error ? error.message : String(error))
    return fallback
  }
}

function injectMetadata(html, meta) {
  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)
  const url = escapeHtml(meta.url)
  const tags = [
    `<meta property="og:site_name" content="Shopvax" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ]
  if (meta.image) {
    const image = escapeHtml(meta.image)
    tags.push(`<meta property="og:image" content="${image}" />`)
    tags.push(`<meta name="twitter:image" content="${image}" />`)
  }
  if (meta.video) tags.push(`<meta property="og:video" content="${escapeHtml(meta.video)}" />`)

  return html
    .replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${description}" />`)
    .replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
}

const originalSendFile = express.response.sendFile
express.response.sendFile = function metadataSendFile(filePath, options, callback) {
  const absolutePath = path.resolve(String(filePath || ''))
  if (path.basename(absolutePath) !== 'index.html' || !this.req || this.headersSent) {
    return originalSendFile.call(this, filePath, options, callback)
  }

  const res = this
  Promise.all([
    htmlCache.has(absolutePath)
      ? Promise.resolve(htmlCache.get(absolutePath))
      : fs.readFile(absolutePath, 'utf8').then((html) => { htmlCache.set(absolutePath, html); return html }),
    metadataFor(res.req),
  ]).then(([html, meta]) => {
    if (res.headersSent) return
    res.type('html').send(injectMetadata(html, meta))
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
