import crypto from 'node:crypto'
import Redis from 'ioredis'

// Optional Redis: losing cache/Redis must never make catalog or checkout unavailable.
const redisUrl = String(process.env.REDIS_URL || '').trim()
let redis = null
let lastErrorAt = 0
if (redisUrl) {
  try {
    redis = new Redis(redisUrl, {
      connectTimeout: 1500,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(1000 * attempt, 5000),
      lazyConnect: false,
    })
    redis.on('error', (error) => {
      if (Date.now() - lastErrorAt > 60000) {
        lastErrorAt = Date.now()
        console.warn('[shopvax-redis] indisponível, usando fallback local/DB:', error.message)
      }
    })
  } catch (error) {
    console.warn('[shopvax-redis] configuração inválida; usando fallback:', error.message)
    redis = null
  }
}

export function redisReady() { return Boolean(redis && redis.status === 'ready') }

const cacheTtl = Math.min(120, Math.max(0, Number(process.env.SHOPVAX_CATALOG_CACHE_TTL_SECONDS ?? 15) || 0))
const singleFlight = new Map()
export function redisKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export async function cachedCatalogQuery(pool, sql, params, ttlSeconds = cacheTtl) {
  if (!redisReady() || !ttlSeconds) return pool.query(sql, params)
  const key = 'shopvax:catalog:v1:' + redisKey(JSON.stringify([sql, params]))
  try {
    const cached = await redis.get(key)
    if (cached !== null) return JSON.parse(cached)
  } catch {
    return pool.query(sql, params)
  }
  if (singleFlight.has(key)) return singleFlight.get(key)
  const pending = (async () => {
    const data = await pool.query(sql, params)
    if (data.rowCount > 0 && redisReady()) {
      try {
        await redis.set(key, JSON.stringify({ rows: data.rows, rowCount: data.rowCount }), 'EX', ttlSeconds)
      } catch { /* Redis is optional; PostgreSQL is the source of truth. */ }
    }
    return data
  })()
  if (singleFlight.size < 256) singleFlight.set(key, pending)
  try { return await pending }
  finally { if (singleFlight.get(key) === pending) singleFlight.delete(key) }
}

const limiterLua = `local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end
return {n,redis.call('PTTL',KEYS[1])}`

// Atomic across all API replicas. Fallback preserves existing process-local defense.
export async function takeSharedRate(key, windowMs, limit, localFallback) {
  if (redisReady()) {
    try {
      const name = 'shopvax:rate:v1:' + redisKey(key + ':' + windowMs)
      const result = await redis.eval(limiterLua, 1, name, String(windowMs))
      const count = Number(result[0])
      const ttl = Math.max(0, Number(result[1]))
      return { ok: count <= limit, retryAfter: count <= limit ? 0 : Math.max(1, Math.ceil(ttl / 1000)) }
    } catch { /* Use local fallback on transient failure. */ }
  }
  return localFallback()
}
