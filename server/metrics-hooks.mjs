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

const rumMetricNames = new Set(['LCP','FCP','INP','CLS','TTFB'])
const rumPageKinds = new Set(['landing','store','feed','panel','other'])
const rumSamples = new Map()
const rumIpLimits = new Map()
const rumSampleLimit = 1024

function recordRum(payload, ip) {
  const metric=String(payload?.metric || '')
  const page=String(payload?.page || '')
  const value=Number(payload?.value)
  if (!rumMetricNames.has(metric) || !rumPageKinds.has(page) || !Number.isFinite(value) ||
    value < 0 || (metric==='CLS' ? value>10 : value>120000)) return false
  const now=Date.now()
  const rate=rumIpLimits.get(ip)
  if (!rate || rate.until < now) rumIpLimits.set(ip,{until:now+60000,count:1})
  else if (++rate.count>120) return null
  const key=metric+':'+page
  const list=rumSamples.get(key) || []
  list.push(Math.round(value*1000)/1000)
  if (list.length>rumSampleLimit) list.shift()
  rumSamples.set(key,list)
  return true
}
function percentile(values, p=0.75) {
  if (!values?.length) return 0
  const ordered=[...values].sort((a,b)=>a-b)
  return ordered[Math.ceil(p*ordered.length)-1]
}
const rumCleanup=setInterval(()=>{
  const now=Date.now()
  for(const [key,entry] of rumIpLimits)if(entry.until<now)rumIpLimits.delete(key)
},60000)
rumCleanup.unref()


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
  lines.push('# HELP shopvax_rum_p75 Real user performance p75, milliseconds except CLS (unitless)')
  lines.push('# TYPE shopvax_rum_p75 gauge')
  lines.push('# HELP shopvax_rum_samples Total retained Real User Monitoring samples')
  lines.push('# TYPE shopvax_rum_samples gauge')
  for (const [key,values] of rumSamples) {
    const [metric,page]=key.split(':')
    const labels='{metric="' + metric + '",page="' + page + '"}'
    lines.push('shopvax_rum_p75' + labels + ' ' + percentile(values).toFixed(3))
    lines.push('shopvax_rum_samples' + labels + ' ' + values.length)
  }
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
  // Client sends only a metric, a coarse page category and a number.
  // No URLs, visitor identifiers, IP addresses or raw navigation data are stored.
  this.post('/api/public/rum', express.json({ limit: '2kb' }), (req,res) => {
    res.setHeader('Cache-Control','no-store')
    const result=recordRum(req.body, String(req.ip || 'unknown'))
    if (result === null) return res.status(429).end()
    if (!result) return res.status(400).end()
    return res.status(204).end()
  })
  this.get('/internal/metrics', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    if (!authorized(req)) return res.status(404).end()
    return res.type('text/plain').send(exposition())
  })
  return result
}
