import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { verifyProduction } from '../scripts/verify-production.mjs'

test('Smoke test valida versão publicada, banco, páginas e favicon sem escrita', async () => {
  let database = true
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url })
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, database, releaseSha: 'sha-release-teste' }))
    }
    if (req.url === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    }
    if (req.url === '/' || req.url === '/entrar') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<html><title>Shopvax</title></html>')
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const result = await verifyProduction({ baseUrl, expectedSha: 'sha-release-teste' })
    assert.equal(result.ok, true)
    assert.equal(result.shaVerified, true)
    assert(seen.every(item => item.method === 'GET'), 'Smoke test nunca faz mutações')
    await assert.rejects(verifyProduction({ baseUrl, expectedSha: 'sha-diferente' }), /SHA do deploy diferente/)
    database = false
    await assert.rejects(verifyProduction({ baseUrl, expectedSha: 'sha-release-teste' }), /Banco de dados indisponível/)
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
})
