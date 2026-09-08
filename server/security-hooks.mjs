import express from 'express'

const authBuckets = new Map()
const platformBuckets = new Map()
const windowMs = 15 * 60 * 1000
const rateLimitDisabled = process.env.SHOPVAX_SECURITY_RATE_LIMIT_DISABLED === '1'

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 120)
}

function take(bucketMap, key, limit, ttl = windowMs) {
  const now = Date.now()
  const current = bucketMap.get(key)
  if (!current || current.resetAt <= now) {
    bucketMap.set(key, { count: 1, resetAt: now + ttl })
    return { ok: true, retryAfter: 0 }
  }
  current.count += 1
  if (current.count <= limit) return { ok: true, retryAfter: 0 }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
}

function requestOrigin(req) {
  const raw = req.get('origin') || ''
  if (!raw) return null
  try { return new URL(raw) } catch { return null }
}

function sameOrigin(req) {
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase()
  if (fetchSite === 'cross-site') return false
  const origin = requestOrigin(req)
  if (!origin) return true
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https:' : 'http:'
  const host = String(req.get('host') || '').toLowerCase()
  return origin.protocol === proto && origin.host.toLowerCase() === host
}

function setSecurityHeaders(req, res) {
  res.removeHeader('X-Powered-By')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self'",
  ].join('; '))
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  if (/^\/api\/(auth|admin|platform)(\/|$)/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, private')
    res.setHeader('Pragma', 'no-cache')
  }
}

function installSecurity(app) {
  if (app.__shopvaxSecurityInstalled) return
  app.__shopvaxSecurityInstalled = true
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    setSecurityHeaders(req, res)

    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    if (unsafe && req.path.startsWith('/api/') && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Origem da requisição não autorizada.' })
    }

    if (!rateLimitDisabled && req.method === 'POST' && (req.path === '/api/auth/login' || req.path === '/api/auth/register')) {
      const limit = req.path.endsWith('/register') ? 6 : 12
      const result = take(authBuckets, `${req.path}:${clientIp(req)}`, limit, req.path.endsWith('/register') ? 60 * 60 * 1000 : windowMs)
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
      }
    }

    if (!rateLimitDisabled && unsafe && req.path.startsWith('/api/platform/')) {
      const result = take(platformBuckets, clientIp(req), 120, 10 * 60 * 1000)
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        return res.status(429).json({ error: 'Muitas operações administrativas em pouco tempo.' })
      }
    }

    if (req.method === 'POST' && req.path === '/api/auth/register') {
      const length = Number(req.get('content-length') || 0)
      if (length > 64 * 1024) return res.status(413).json({ error: 'Cadastro maior que o permitido.' })
    }

    next()
  })
}

const cleanup = setInterval(() => {
  const now = Date.now()
  for (const map of [authBuckets, platformBuckets]) {
    for (const [key, bucket] of map.entries()) if (bucket.resetAt <= now) map.delete(key)
  }
}, 60_000)
cleanup.unref()

const originalInit = express.application.init
express.application.init = function securityInit(...args) {
  const result = originalInit.apply(this, args)
  installSecurity(this)
  return result
}
