import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// Run ONLY against isolated staging with a copy of production data.
// Example: BASE_URL=https://staging.example STORE_SLUG=demo k6 run tests/load/catalog-checkout.k6.js
const base = (__ENV.BASE_URL || '').replace(/\/$/, '')
const store = __ENV.STORE_SLUG || ''
const seller = __ENV.SELLER_SLUG || ''
if (!base || !store) throw new Error('BASE_URL and STORE_SLUG are required')
const path = '/api/public/store/' + encodeURIComponent(store) + (seller ? '/' + encodeURIComponent(seller) : '')
export const errorRate = new Rate('catalog_errors')
export const latency = new Trend('catalog_latency', true)
export const options = {
  stages: [
    { duration: '1m', target: 25 }, { duration: '2m', target: 50 },
    { duration: '2m', target: 100 }, { duration: '2m', target: 200 },
    { duration: '2m', target: 500 }, { duration: '1m', target: 0 },
  ],
  thresholds: {
    'catalog_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<800', 'p(99)<1600'],
  },
}
export default function () {
  const result = http.get(base + path + '?limit=24', { tags: { flow: 'catalog' }, timeout: '10s' })
  const ok = check(result, { 'status 200': r => r.status === 200, 'products available': r => {
    try { return Array.isArray(r.json('products')) } catch { return false }
  } })
  errorRate.add(!ok)
  latency.add(result.timings.duration)
  sleep(4 + Math.random() * 4)
}
// Checkout and order-writing stress requires isolated seeded accounts and idempotency checks.
// Never send synthetic orders to real shops or WhatsApp.
