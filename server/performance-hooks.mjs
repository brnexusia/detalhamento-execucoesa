import express from 'express'
import compression from 'compression'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 }) : null

if (pool) pool.on('error', (error) => console.error('[performance] pool:', error.message))

let indexAttempts = 0
async function ensurePerformanceIndexes() {
  if (!pool) return
  indexAttempts += 1
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_products_public_order
        ON products(store_id, featured DESC, created_at DESC, id DESC)
        WHERE active=true;
      CREATE INDEX IF NOT EXISTS idx_products_public_category_order
        ON products(store_id, category, featured DESC, created_at DESC, id DESC)
        WHERE active=true;
    `)
  } catch (error) {
    if (indexAttempts < 10) {
      const retry = setTimeout(() => void ensurePerformanceIndexes(), 1000)
      retry.unref()
    } else {
      console.error('[performance] indexes:', error instanceof Error ? error.message : String(error))
    }
  }
}
if (pool) {
  const startup = setTimeout(() => void ensurePerformanceIndexes(), 500)
  startup.unref()
}

const originalStatic = express.static
express.static = function performanceStatic(root, options = {}) {
  const previousSetHeaders = options.setHeaders
  return originalStatic(root, {
    ...options,
    setHeaders(res, filePath, stat) {
      previousSetHeaders?.(res, filePath, stat)
      if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  })
}

const originalInit = express.application.init
express.application.init = function performancePatchedInit(...args) {
  const result = originalInit.apply(this, args)
  if (this.__atacadoPerformanceInstalled) return result
  this.__atacadoPerformanceInstalled = true

  this.disable('x-powered-by')
  this.set('etag', 'strong')
  this.use(compression({ threshold: 1024 }))
  this.use((req, res, next) => {
    res.setHeader('X-DNS-Prefetch-Control', 'on')
    res.setHeader('Permissions-Policy', 'interest-cohort=()')

    // A primeira tela da loja precisa de poucos produtos. O restante entra por cursor
    // conforme o usuário se aproxima do fim da grade/feed.
    if (req.method === 'GET' && req.url.startsWith('/api/public/store/')) {
      try {
        const url = new URL(req.url, 'http://atacado.local')
        if (!url.searchParams.has('limit')) {
          url.searchParams.set('limit', '12')
          req.url = `${url.pathname}?${url.searchParams.toString()}`
        }
      } catch {}
    }

    next()
  })

  return result
}
