import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fetchChecked = async (base, pathname, expectedType) => {
  const url = new URL(pathname, base)
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } })
  assert.equal(response.status, 200, `${pathname}: status HTTP ${response.status}`)
  const type = response.headers.get('content-type') || ''
  assert.match(type, expectedType, `${pathname}: Content-Type inesperado ${type}`)
  return response
}

/** Smoke test público somente leitura. Não executa migrações nem envia pedidos. */
export async function verifyProduction({ baseUrl, expectedSha }) {
  assert(baseUrl, 'Informe SHOPVAX_PUBLIC_URL.')
  const base = new URL(baseUrl)
  assert(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname),
    'Somente HTTPS é permitido fora de ambiente local.')
  const healthResponse = await fetchChecked(base, '/health', /application\/json/i)
  const health = await healthResponse.json()
  assert.equal(health.ok, true, '/health não retornou ok=true')
  assert.equal(health.database, true, 'Banco de dados indisponível em produção')
  const releaseSha = typeof health.releaseSha === 'string' ? health.releaseSha.trim() : ''
  if (expectedSha) {
    assert(releaseSha, 'SHOPVAX_RELEASE_SHA não está definido no serviço publicado.')
    assert.equal(releaseSha, expectedSha, 'SHA do deploy diferente do commit esperado')
  }
  const homepage = await (await fetchChecked(base, '/', /text\/html/i)).text()
  assert.match(homepage, /shopvax/i, 'A página inicial não contém identificação Shopvax')
  await fetchChecked(base, '/entrar', /text\/html/i)
  const icon = await (await fetchChecked(base, '/favicon.svg', /image\/svg\+xml|text\/xml/i)).text()
  assert.match(icon, /<svg\b/i, 'Favicon SVG não encontrado')
  return { ok: true, origin: base.origin, database: true, releaseSha: releaseSha || null, shaVerified: Boolean(expectedSha) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyProduction({
    baseUrl: process.env.SHOPVAX_PUBLIC_URL,
    expectedSha: process.env.SHOPVAX_EXPECTED_SHA?.trim() || '',
  }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (!result.shaVerified) process.stdout.write('AVISO: SHA não verificado. Defina SHOPVAX_EXPECTED_SHA e SHOPVAX_RELEASE_SHA.\n')
  }).catch(error => {
    process.stderr.write('Falha na homologação pública: ' + error.message + '\n')
    process.exitCode = 1
  })
}
