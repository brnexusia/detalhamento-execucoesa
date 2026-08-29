import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 5000 }) : null

if (pool) pool.on('error', (error) => console.error('[business features] pool:', error.message))

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.')
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_images jsonb NOT NULL DEFAULT '[]'::jsonb;
  `)
}

let schemaPromise = null
function schemaReady() {
  if (!schemaPromise) schemaPromise = ensureSchema().catch((error) => {
    schemaPromise = null
    throw error
  })
  return schemaPromise
}
if (pool) {
  const timer = setTimeout(() => void schemaReady().catch((error) => console.error('[business features] schema:', error.message)), 750)
  timer.unref()
}

function uniqueImages(row, fallback) {
  const values = [...(Array.isArray(row?.images) ? row.images : []), fallback || '']
  const seen = new Set()
  return values.map((value) => String(value || '').trim()).filter((value) => value && !seen.has(value) && seen.add(value)).slice(0, 40)
}

function install(app) {
  if (app.__atacadoBusinessFeaturesInstalled) return
  app.__atacadoBusinessFeaturesInstalled = true
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next()
    Promise.resolve(schemaReady()).then(() => {
      if (req.method === 'GET' && req.path.startsWith('/api/public/store/')) {
        const originalJson = res.json.bind(res)
        res.json = async (payload) => {
          try {
            if (Array.isArray(payload?.products) && payload.products.length) {
              const ids = payload.products.map((product) => String(product.id || '')).filter(Boolean)
              const result = await pool.query('SELECT id,images,variant_images,media_url,media_type FROM products WHERE id=ANY($1::text[])', [ids])
              const byId = new Map(result.rows.map((row) => [row.id, row]))
              payload.products = payload.products.map((product) => {
                const row = byId.get(product.id)
                if (!row) return product
                const images = uniqueImages(row, row.media_type !== 'video' ? row.media_url : '')
                return {
                  ...product,
                  images,
                  variantImages: Array.isArray(row.variant_images) ? row.variant_images : [],
                  mediaUrl: product.mediaUrl || images[0] || '',
                }
              })
            }
          } catch (error) {
            console.error('[business features] gallery payload:', error.message)
          }
          return originalJson(payload)
        }
      }
      next()
    }).catch(next)
  })
}

const previousInit = express.application.init
express.application.init = function businessFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
