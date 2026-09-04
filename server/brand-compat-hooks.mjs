import express from 'express'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL?.trim() || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 3000 }) : null
const legacySession = 'atacado_session'
const shopvaxSession = 'shopvax_session'
const legacyPublic = 'atacado_public'
const shopvaxPublic = 'shopvax_public'

if (pool) pool.on('error', (error) => console.error('[shopvax compat] pool:', error.message))

function cookieMap(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)]
  }))
}

function appendLegacyAlias(req, modernName, legacyName) {
  const current = String(req.headers.cookie || '')
  const cookies = cookieMap(current)
  if (!cookies[modernName] || cookies[legacyName]) return
  req.headers.cookie = `${current}${current ? '; ' : ''}${legacyName}=${cookies[modernName]}`
}

const originalCookie = express.response.cookie
express.response.cookie = function shopvaxCookie(name, value, options) {
  if (name === legacySession) originalCookie.call(this, shopvaxSession, value, options)
  if (name === legacyPublic) originalCookie.call(this, shopvaxPublic, value, options)
  return originalCookie.call(this, name, value, options)
}

const originalClearCookie = express.response.clearCookie
express.response.clearCookie = function shopvaxClearCookie(name, options) {
  if (name === legacySession) originalClearCookie.call(this, shopvaxSession, options)
  if (name === legacyPublic) originalClearCookie.call(this, shopvaxPublic, options)
  return originalClearCookie.call(this, name, options)
}

const originalInit = express.application.init
express.application.init = function brandCompatInit(...args) {
  const result = originalInit.apply(this, args)
  if (this.__shopvaxBrandCompatInstalled) return result
  this.__shopvaxBrandCompatInstalled = true
  this.use((req, _res, next) => {
    appendLegacyAlias(req, shopvaxSession, legacySession)
    appendLegacyAlias(req, shopvaxPublic, legacyPublic)
    next()
  })
  return result
}

const originalLog = console.log.bind(console)
console.log = (...args) => originalLog(...args.map((value) => typeof value === 'string' ? value.replaceAll('[atacado-shop]', '[shopvax]') : value))

async function installOrderPrefixMigration() {
  if (!pool) return
  await pool.query(`
    CREATE OR REPLACE FUNCTION shopvax_order_code_prefix()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.code LIKE 'AS-%' THEN
        NEW.code := 'SV-' || substring(NEW.code FROM 4);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_shopvax_order_code_prefix ON orders;
    CREATE TRIGGER trg_shopvax_order_code_prefix
      BEFORE INSERT ON orders
      FOR EACH ROW EXECUTE FUNCTION shopvax_order_code_prefix();
  `)
}

if (pool) {
  let attempts = 0
  const install = async () => {
    attempts += 1
    try { await installOrderPrefixMigration() }
    catch (error) {
      if (attempts < 12) {
        const retry = setTimeout(() => void install(), 1000)
        retry.unref()
      } else console.error('[shopvax compat] order prefix:', error instanceof Error ? error.message : String(error))
    }
  }
  const timer = setTimeout(() => void install(), 300)
  timer.unref()
}
