import express from 'express'
import { takeSharedRate } from './redis-runtime.mjs'
import { publicMutationLimit } from './public-mutation-limits.mjs'

const authBuckets = new Map()
const platformBuckets = new Map()
const publicMutationBuckets = new Map()
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
  if (req.get('origin') && !origin) return false
  if (!origin) return true
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https:' : 'http:'
  const host = String(req.get('host') || '').toLowerCase()
  return origin.protocol === proto && origin.host.toLowerCase() === host
}

// Storefront images should be hosted on /media whenever possible. A fixed,
// reviewable allowlist replaces the blanket https: source previously applied
// to every image and video on every page. Extra trusted media origins must be
// explicitly configured by the operator, never derived from visitor input.
const defaultImageOrigins = [
  'https://images.unsplash.com',
  'https://images.pexels.com',
  'https://thumb.braavo.me',
  'https://cdn.shopify.com',
  'https://res.cloudinary.com',
  'https://static.wixstatic.com',
  'https://i.pinimg.com',
  'https://storage.googleapis.com',
  'https://firebasestorage.googleapis.com',
  'https://lh3.googleusercontent.com',
]
const defaultVideoOrigins = [
  'https://cdn.shopify.com',
  'https://video.shopifycdn.com',
  'https://res.cloudinary.com',
  'https://storage.googleapis.com',
]
function trustedMediaOrigins(value) {
  return String(value || '').split(/[\s,]+/).map((item) => {
    if (!item) return ''
    try {
      const url = new URL(item.includes('://') ? item : 'https://' + item)
      if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '443') ||
        !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') ||
        url.hostname.includes('..')) return ''
      return url.origin
    } catch { return '' }
  }).filter(Boolean).slice(0, 32)
}
const extraMediaOrigins = trustedMediaOrigins(process.env.SHOPVAX_CSP_MEDIA_ORIGINS)
const imageOrigins = [...new Set([...defaultImageOrigins, ...extraMediaOrigins])].join(' ')
const videoOrigins = [...new Set([...defaultVideoOrigins, ...extraMediaOrigins])].join(' ')

function setSecurityHeaders(req, res) {
  res.removeHeader('X-Powered-By')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  const googleIdentityEnabled = Boolean(String(process.env.GOOGLE_CLIENT_ID || '').trim())
  res.setHeader('Cross-Origin-Opener-Policy', googleIdentityEnabled ? 'same-origin-allow-popups' : 'same-origin')
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    // Allow external CSS files only. DOM CSSOM property changes from React
    // remain possible without allowing arbitrary inline <style> or style=.
    "style-src 'self' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "style-src-elem 'self' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${imageOrigins}`,
    `media-src 'self' blob: ${videoOrigins}`,
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-src https://accounts.google.com/gsi/",
  ].join('; '))
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  if (/^\/api\/(auth|admin|platform)(\/|$)/.test(req.path) || /^\/api\/(business\/orders|public\/phase4\/(payments|orders))(\/|$)/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, private')
    res.setHeader('Pragma', 'no-cache')
  }
}

function installSecurity(app) {
  if (app.__shopvaxSecurityInstalled) return
  app.__shopvaxSecurityInstalled = true
  app.disable('x-powered-by')
  app.use(async (req, res, next) => {
    try {
    setSecurityHeaders(req, res)

    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    if (unsafe && req.path.startsWith('/api/') && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Origem da requisição não autorizada.' })
    }

    const customerAuthMatch = req.path.match(/^\/api\/public\/store\/[^/]+\/customers\/(login|register)$/)
    if (!rateLimitDisabled && req.method === 'POST' && (['/api/auth/login', '/api/auth/register', '/api/auth/google', '/api/partners/login', '/api/partners/register'].includes(req.path) || customerAuthMatch)) {
      const isRegister = ['/api/auth/register', '/api/partners/register'].includes(req.path) || customerAuthMatch?.[1] === 'register'
      const limit = isRegister ? 6 : 12
      const key = `${req.path}:${clientIp(req)}`
      const ttl = isRegister ? 60 * 60 * 1000 : windowMs
      const result = await takeSharedRate('auth:' + key, ttl, limit, () => take(authBuckets, key, limit, ttl))
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
      }
    }

    const mutationPolicy = publicMutationLimit(req.method, req.path)
    if (!rateLimitDisabled && mutationPolicy) {
      const key = `${mutationPolicy.bucket}:${clientIp(req)}`
      const result = await takeSharedRate(`public-write:${key}`, mutationPolicy.windowMs, mutationPolicy.max,
        () => take(publicMutationBuckets, key, mutationPolicy.max, mutationPolicy.windowMs))
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        return res.status(429).json({ error: 'Muitas solicitações. Aguarde alguns minutos antes de tentar novamente.' })
      }
    }

    if (!rateLimitDisabled && unsafe && req.path.startsWith('/api/platform/')) {
      const ip = clientIp(req)
      const result = await takeSharedRate('platform:' + ip, 10 * 60 * 1000, 120, () => take(platformBuckets, ip, 120, 10 * 60 * 1000))
      if (!result.ok) {
        res.setHeader('Retry-After', String(result.retryAfter))
        return res.status(429).json({ error: 'Muitas operações administrativas em pouco tempo.' })
      }
    }

    if (req.method === 'POST' && (req.path === '/api/auth/register' || req.path === '/api/auth/google' || req.path === '/api/partners/register' || /^\/api\/public\/store\/[^/]+\/customers\/register$/.test(req.path))) {
      const length = Number(req.get('content-length') || 0)
      if (length > 64 * 1024) return res.status(413).json({ error: 'Cadastro maior que o permitido.' })
    }

    next()
    } catch (error) { next(error) }
  })
}

const cleanup = setInterval(() => {
  const now = Date.now()
  for (const map of [authBuckets, platformBuckets, publicMutationBuckets]) {
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
