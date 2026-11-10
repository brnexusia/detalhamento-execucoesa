import test from 'node:test'
import assert from 'node:assert/strict'
import { isClientSpaPage, isDemoStorePage, metadataFor } from './page-metadata-hooks.mjs'

test('rotas SPA publicas e portal parceiro sao reconhecidos sem buscar loja no banco', async () => {
  for (const path of ['/feed', '/descobrir', '/buscar', '/salvos', '/carrinhos',
    '/parceiros', '/parceiros/cadastro', '/parceiros/entrar']) {
    assert.equal(isClientSpaPage(path), true, path)
    const meta = await metadataFor({ originalUrl: path })
    assert.equal(meta.status, 200, path)
    assert.equal(meta.index, false, path)
  }
})

test('a loja demonstrativa nao recebe 404 indevido e nao e indexada', async () => {
  for (const path of ['/casa-norte', '/casa-norte/marina', '/casa-norte/bianca']) {
    assert.equal(isDemoStorePage(path), true)
    const meta = await metadataFor({ originalUrl: path })
    assert.equal(meta.status, 200, path)
    assert.equal(meta.index, false, path)
    assert.match(meta.title, /demonstrativa/)
  }
})

test('nao mascarar slugs reais, routes arbitrarias nem APIs como SPA', () => {
  for (const path of ['/loja-inexistente', '/perfil/loja-inexistente',
    '/api/public/store/inexistente', '/buscar/coisa', '/parceiros/../../api',
    '/casa-norte/sem-vendedora', '/qualquer-outra-loja']) {
    assert.equal(isClientSpaPage(path), false, path)
    assert.equal(isDemoStorePage(path), false, path)
  }
})

test('pagina comercial para lojistas continua indexavel', async () => {
  const meta = await metadataFor({ originalUrl: '/para-lojas' })
  assert.equal(meta.status, 200)
  assert.equal(meta.index, true)
})
