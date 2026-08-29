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

function install(app) {
  if (app.__atacadoBusinessFeaturesInstalled) return
  app.__atacadoBusinessFeaturesInstalled = true
  app.use((req, _res, next) => {
    if (!req.path.startsWith('/api/')) return next()
    Promise.resolve(schemaReady()).then(() => next()).catch(next)
  })
}

const previousInit = express.application.init
express.application.init = function businessFeaturesInit(...args) {
  const result = previousInit.apply(this, args)
  install(this)
  return result
}
