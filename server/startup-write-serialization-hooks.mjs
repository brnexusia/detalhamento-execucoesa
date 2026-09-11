import pg from 'pg'

const { Pool } = pg
const originalQuery = Pool.prototype.query
const bootStartedAt = Date.now()
const bootWindowMs = Math.max(4_000, Math.min(30_000, Number(process.env.SHOPVAX_STARTUP_WRITE_SERIALIZATION_MS) || 12_000))
let writeQueue = Promise.resolve()

function sqlText(args) {
  const first = args[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && typeof first.text === 'string') return first.text
  return ''
}

function isReadOnly(sql) {
  const normalized = String(sql || '').replace(/^\s*(?:--[^\n]*\n\s*)*/g, '').trim().toUpperCase()
  return normalized.startsWith('SELECT ') || normalized === 'SELECT' || normalized.startsWith('SHOW ') || normalized.startsWith('EXPLAIN ')
}

function shouldSerialize(args) {
  if (Date.now() - bootStartedAt > bootWindowMs) return false
  const sql = sqlText(args)
  if (!sql) return false
  return !isReadOnly(sql)
}

function runPromiseQuery(pool, args) {
  return originalQuery.apply(pool, args)
}

function enqueuePromise(pool, args) {
  const task = writeQueue
    .catch(() => undefined)
    .then(() => runPromiseQuery(pool, args))
  writeQueue = Promise.resolve(task).then(() => undefined, () => undefined)
  return task
}

function enqueueCallback(pool, args, callback) {
  const task = writeQueue
    .catch(() => undefined)
    .then(() => new Promise((resolve) => {
      originalQuery.call(pool, ...args, (error, result) => {
        try { callback(error, result) }
        finally { resolve() }
      })
    }))
  writeQueue = Promise.resolve(task).then(() => undefined, () => undefined)
  return undefined
}

Pool.prototype.query = function startupSerializedQuery(...args) {
  if (!shouldSerialize(args)) return originalQuery.apply(this, args)
  const callback = typeof args.at(-1) === 'function' ? args.pop() : null
  if (callback) return enqueueCallback(this, args, callback)
  return enqueuePromise(this, args)
}
