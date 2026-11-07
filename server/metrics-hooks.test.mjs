import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

process.env.SHOPVAX_METRICS_TOKEN = 'ci-only-metrics-secret-at-least-32-chars'
await import('./metrics-hooks.mjs')

test('telemetry is protected and exposes only aggregate measurements', async () => {
  const app = express()
  app.get('/sample', (_req, res) => res.json({ ok: true }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise(resolve => server.once('listening', resolve))
    const url = 'http://127.0.0.1:' + server.address().port
    assert.equal((await fetch(url + '/sample')).status, 200)
    assert.equal((await fetch(url + '/internal/metrics')).status, 404)
    assert.equal((await fetch(url + '/internal/metrics', { headers: { authorization: 'Bearer invalid' } })).status, 404)
    const badRum=await fetch(url + '/api/public/rum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metric:'LCP',value:1,page:'https://sensitive.example/private'})})
    assert.equal(badRum.status,400)
    const rum=await fetch(url + '/api/public/rum',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metric:'LCP',value:1250,page:'store'})})
    assert.equal(rum.status,204)
    const r = await fetch(url + '/internal/metrics', {
      headers: { authorization: 'Bearer ci-only-metrics-secret-at-least-32-chars' },
    })
    assert.equal(r.status, 200)
    const body = await r.text()
    assert.match(body, /shopvax_http_requests_total/)
    assert.match(body, /shopvax_http_duration_ms_bucket/)
    assert.match(body, /shopvax_process_resident_bytes/)
    assert.match(body, /shopvax_rum_p75\\{metric="LCP",page="store"\\} 1250/)
    assert.match(body, /shopvax_rum_samples\\{metric="LCP",page="store"\\} 1/)
    assert.doesNotMatch(body, /ci-only-metrics-secret/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
