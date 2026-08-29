import express from 'express'
import compression from 'compression'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 }) : null

if (pool) {
  pool.on('error', (error) => console.error('[performance] pool:', error.message))
  void pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_public_order
      ON products(store_id, featured DESC, created_at DESC, id DESC)
      WHERE active=true;
    CREATE INDEX IF NOT EXISTS idx_products_public_category_order
      ON products(store_id, category, featured DESC, created_at DESC, id DESC)
      WHERE active=true;
  `).catch((error) => console.error('[performance] indexes:', error.message))
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
    next()
  })

  return result
}
