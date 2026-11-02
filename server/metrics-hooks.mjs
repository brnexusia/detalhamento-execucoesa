import crypto from 'node:crypto'
import express from 'express'

// Process-local Prometheus histogram. Never expose operational metrics without a bearer secret.
const secret = String(process.env.SHOPVAX_METRICS_TOKEN || '')
const expected = secret.length >= 32 ? crypto.createHash('sha256').update(secret).digest() : null
const limits = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity]
const buckets = limits.map(() => 0)
const counts = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 }
let total = 0
let sum = 0

function recorded(ms, status) {
  total++
  sum += ms
  const label = status >= 200 && status < 600 ? Math.floor(status / 100) + 'xx' : 'other'
  counts[label]++
  for (let i = 0; i < limits.length; i++) if (ms <= limits[i]) buckets[i]++
}

function authorized(req) {
  if (!expected) return false
  const header = String(req.get('authorization') || '')
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const current = crypto.createHash('sha256').update(supplied).digest()
  return crypto.timingSafeEqual(expected, current)
}

function exposition() {
  const lines = [
    '# HELP shopvax_http_requests_total HTTP requests by status class',
    '# TYPE shopvax_http_requests_total counter',
  ]
  for (const [label, count] of Object.entries(counts)) {
    lines.push('shopvax_http_requests_total{status_class="' + label + '"} ' + count)
  }
  lines.push('# HELP shopvax_http_duration_ms Duration of HTTP responses in milliseconds')
  lines.push('# TYPE shopvax_http_duration_ms histogram')
  for (let i = 0; i < limits.length; i++) {
    lines.push('shopvax_http_duration_ms_bucket{le="' + (Number.isFinite(limits[i]) ? limits[i] : '+Inf') + '"} ' + buckets[i])
  }
  lines.push('shopvax_http_duration_ms_sum ' + sum.toFixed(3))
  lines.push('shopvax_http_duration_ms_count ' + total)
  lines.push('# HELP shopvax_process_resident_bytes Resident memory in bytes')
  lines.push('# TYPE shopvax_process_resident_bytes gauge')
  lines.push('shopvax_process_resident_bytes ' + process.memoryUsage().rss)
  return lines.join('\n') + '\n'
}

const originalInit = express.application.init
express.application.init = function shopvaxMetricsInit(...args) {
  const result = originalInit.apply(this, args)
  if (this.__shopvaxMetricsInstalled) return result
  this.__shopvaxMetricsInstalled = true
  this.use((_req, res, next) => {
    const start = process.hrtime.bigint()
    res.once('finish', () => {
      recorded(Number(process.hrtime.bigint() - start) / 1e6, res.statusCode)
    })
    next()
  })
  this.get('/internal/metrics', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!authorized(req)) return res.status(404).end()
    return res.type('text/plain').send(exposition())
  })
  return result
}
