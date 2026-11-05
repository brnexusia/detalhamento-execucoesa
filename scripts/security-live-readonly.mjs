import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'
import { spawnSync } from 'node:child_process'
import http from 'node:http'

const host = 'shopvax.com.br'
const budgetMs = 6000
const output = (type, data) => console.log(JSON.stringify({ type, ...data }))
const timeout = (ms) => AbortSignal.timeout(ms)

async function tcpConnect(ip, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port, timeout: 1800 })
    let done = false
    const finish = (state) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(state)
    }
    socket.on('connect', () => finish('connected'))
    socket.on('timeout', () => finish('timeout'))
    socket.on('error', (error) => finish(error.code === 'ECONNREFUSED' ? 'refused' : 'filtered_or_unreachable'))
  })
}

async function inspectTls() {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true, timeout: budgetMs }, () => {
      const certificate = socket.getPeerCertificate()
      const result = {
        verified: socket.authorized,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.standardName,
        issuer: certificate.issuer?.O || certificate.issuer?.CN || null,
        validFrom: certificate.valid_from,
        validTo: certificate.valid_to,
        names: certificate.subjectaltname?.split(',').map(x => x.trim()).filter(x => x.includes(host)).slice(0, 3),
      }
      socket.end()
      resolve(result)
    })
    socket.on('timeout', () => { socket.destroy(); resolve({ verified: false, error: 'timeout' }) })
    socket.on('error', (e) => resolve({ verified: false, error: e.code || 'TLS_ERROR' }))
  })
}

function protocolProbe(flag) {
  const result = spawnSync('openssl', ['s_client', '-brief', '-connect', host + ':443',
    '-servername', host, flag, '-cipher', 'DEFAULT:@SECLEVEL=0'], {
    input: '', encoding: 'utf8', timeout: budgetMs,
  })
  const text = String(result.stdout || '') + String(result.stderr || '')
  const negotiated = /Protocol version:\s*(TLSv[\d.]+)/i.exec(text)?.[1] || null
  return {
    accepted: Boolean(result.status === 0 && negotiated),
    negotiated,
    result: result.status === 0 ? 'completed' : 'no_handshake',
    warning: result.status !== 0 ? 'May be rejected by server OR client OpenSSL configuration' : null,
  }
}

async function readPublicDns() {
  try {
    const response = await fetch('https://dns.google/resolve?name=shopvax.com.br&type=A', {signal: timeout(5000)})
    const data = await response.json()
    return { addresses: (data.Answer || []).filter(x => x.type === 1).map(x => x.data).slice(0, 8), status: data.Status }
  } catch(error) {return {error: error.cause?.code || error.name}}
}

async function probeService(ip, port, path = '/health') {
  return new Promise(resolve => {
    if (port === 22) {
      const socket = net.connect({ host: ip, port, timeout: 2300 })
      let done = false
      const finish = value => {if(done)return;done=true;socket.destroy();resolve(value)}
      socket.on('data', chunk => finish({ port, banner: chunk.toString('ascii').slice(0, 90).replace(/[^\x20-\x7e]/g, '') }))
      socket.on('timeout', () => finish({ port, banner: null }))
      socket.on('error', e => finish({ port, error: e.code }))
      socket.on('close', () => finish({ port, banner: null }))
      return
    }
    let finished = false
    const request = http.get({ host: ip, port, path, timeout: 3000, headers: { Host: host, 'User-Agent': 'ShopVax-readonly-audit' } }, response => {
      let body = ''
      response.on('data', x => { if(body.length < 1024) body += x.toString('utf8').slice(0, 1024); })
      response.on('end', () => {
        if(finished)return;finished=true
        let parsed = null
        try {parsed = JSON.parse(body)} catch{}
        resolve({ port, path, status: response.statusCode,
          contentType: response.headers['content-type'] || null,
          title: new RegExp('<title[^>]*>([^<]{1,100})</title>', 'i').exec(body)?.[1] || null,
          poweredBy: response.headers['x-powered-by'] || null,
          server: response.headers.server || null,
          healthShape: parsed ? {ok: typeof parsed.ok === 'boolean', database: typeof parsed.database === 'boolean'} : null })
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', e => { if(finished)return;finished=true;resolve({port,error:e.code || e.name})})
  })
}

function safeCookieFlags(headers) {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  return cookies.map(value => ({
    name: value.split('=')[0].slice(0, 60),
    secure: /;\s*secure(?:;|$)/i.test(value),
    httpOnly: /;\s*httponly(?:;|$)/i.test(value),
    sameSite: /;\s*samesite=(strict|lax|none)/i.exec(value)?.[1]?.toLowerCase() || 'missing',
  }))
}

async function httpProbe(path, options = {}) {
  try {
    const response = await fetch((options.http ? 'http://' : 'https://') + host + path, {
      redirect: 'manual', method: options.method || 'GET', signal: timeout(budgetMs),
      headers: options.headers || {},
    })
    const headers = response.headers
    const result = {
      path, method: options.method || 'GET', status: response.status,
      contentType: headers.get('content-type'),
      location: (headers.get('location') || '').split('?')[0].slice(0, 120) || null,
      server: headers.get('server'), poweredBy: headers.get('x-powered-by'),
      hsts: headers.get('strict-transport-security'),
      csp: (headers.get('content-security-policy') || '').slice(0, 400) || null,
      xfo: headers.get('x-frame-options'), nosniff: headers.get('x-content-type-options'),
      referrer: headers.get('referrer-policy'), permissions: headers.get('permissions-policy'),
      cache: headers.get('cache-control'),
      corsOrigin: headers.get('access-control-allow-origin'),
      corsCredentials: headers.get('access-control-allow-credentials'),
      cookies: safeCookieFlags(headers),
    }
    if (path === '/health' && response.ok) {
      const body = await response.json().catch(() => null)
      result.health = { ok: body?.ok, database: body?.database, releaseSha: body?.releaseSha || null }
    }
    if (response.body) await response.body.cancel().catch(() => undefined)
    output('http', result)
  } catch (error) {
    output('http', { path, method: options.method || 'GET', error: error.cause?.code || error.name })
  }
}

output('scope', { host, testType: 'read-only', note: 'Public edge may differ from the private origin' })
try {
  const addresses = [...new Set((await dns.lookup(host, { all: true })).map(r => r.address))].slice(0, 2)
  output('dns', { addresses })
  output('dnsPublicResolver', await readPublicDns())
  for (const ip of addresses) {
    for (const port of [22, 80, 443, 3000, 5432, 6379, 8080]) {
      output('tcp', { ip, port, state: await tcpConnect(ip, port) })
    }
  }
  if (addresses[0]) {
    output('service', await probeService(addresses[0], 22))
    output('service', await probeService(addresses[0], 3000, '/health'))
    output('service', await probeService(addresses[0], 3000, '/'))
    output('service', await probeService(addresses[0], 3000, '/api/platform/bootstrap'))
  }
} catch (error) { output('dns', { error: error.code || error.name }) }
output('tls', await inspectTls())
for (const flag of ['-tls1', '-tls1_1', '-tls1_2', '-tls1_3']) output('tlsProtocol', { flag, ...protocolProbe(flag) })
await httpProbe('/', { http: true })
for (const path of [
  '/', '/entrar', '/health', '/robots.txt', '/sitemap.xml',
  '/api/public/store/lookpremium', '/api/platform/bootstrap',
  '/api/admin/products', '/api/v1/products', '/openapi.json',
  '/swagger.json', '/api-docs', '/.env', '/.git/HEAD', '/backup.zip', '/.well-known/security.txt',
]) await httpProbe(path)
await httpProbe('/api/public/store/lookpremium', { headers: { Origin: 'https://unrelated-audit.example' } })
await httpProbe('/api/platform/bootstrap', { headers: { Origin: 'https://unrelated-audit.example' } })
await httpProbe('/api/public/store/lookpremium', { method: 'OPTIONS', headers: { Origin: 'https://unrelated-audit.example', 'Access-Control-Request-Method': 'GET' } })
output('complete', { finished: true })
