import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SHOPVAX_PUBLIC_ORIGIN,
  canonicalPublicShareLink,
  publicStoreLink,
  publicSellerLink,
  publicCatalogLink,
  parsePublicStorePath,
  publicReferralLink,
} from '../src/public-share-links.ts'

test('todos os links publicos devem apontar para shopvax.com.br, nunca para EasyPanel', () => {
  assert.equal(SHOPVAX_PUBLIC_ORIGIN, 'https://shopvax.com.br')
  const oldOrigin = 'https://shopvax-shopvax.easypanel.host'
  const links = [
    publicStoreLink('minha-loja'),
    publicSellerLink('minha-loja', 'maria'),
    publicCatalogLink('minha-loja', 'atacado'),
    publicReferralLink('SVP-ABCD1234'),
  ]
  for (const link of links) {
    assert.equal(new URL(link).origin, 'https://shopvax.com.br')
    assert.equal(link.includes('easypanel'), false)
    assert.equal(link.startsWith(oldOrigin), false)
  }
})

test('link individual identifica a mesma loja e a vendedora correta', () => {
  assert.equal(publicSellerLink('loja-teste', 'vendedora-ana'), 'https://shopvax.com.br/loja-teste/vendedora-ana')
  assert.equal(publicStoreLink('loja-teste'), 'https://shopvax.com.br/loja-teste')
})

test('links de indicacao preservam codigo, inclusive caracteres reservados', () => {
  assert.equal(publicReferralLink('SVP-EXEMPLO'), 'https://shopvax.com.br/criar-conta?ref=SVP-EXEMPLO')
  assert.equal(new URL(publicReferralLink('SVP-A&B')).searchParams.get('ref'), 'SVP-A&B')
})

test('link de catalogo preserva a selecao sem perder a rota publica', () => {
  assert.equal(publicCatalogLink('loja-teste','atacado-2026'), 'https://shopvax.com.br/loja-teste/catalogo/atacado-2026')
  assert.equal(publicCatalogLink('loja-teste','atacado-2026','maria'), 'https://shopvax.com.br/loja-teste/maria/atacado-2026')
  assert.equal(publicCatalogLink('loja-teste','atacado-2026','catalogo'), 'https://shopvax.com.br/loja-teste/catalogo?catalog=atacado-2026')
})


test('copiar link da vendedora sempre usa o domínio público mesmo vindo de um painel EasyPanel', () => {
  assert.equal(
    canonicalPublicShareLink('https://shopvax-shopvax.easypanel.host/minha-loja/vendedora-ana'),
    'https://shopvax.com.br/minha-loja/vendedora-ana',
  )
  assert.equal(
    canonicalPublicShareLink(publicSellerLink('loja-teste', 'maria')),
    'https://shopvax.com.br/loja-teste/maria',
  )
  assert.equal(
    canonicalPublicShareLink('/loja-teste/maria?catalog=atacado#produto-1'),
    'https://shopvax.com.br/loja-teste/maria?catalog=atacado#produto-1',
  )
})

test('nunca copia domínios de terceiros como se fossem links da loja', () => {
  assert.throws(() => canonicalPublicShareLink('https://site-externo.com.br/minha-loja/maria'))
  assert.throws(() => canonicalPublicShareLink('javascript:alert(1)'))
})

test('links curtos identificam loja, vendedora e pasta sem misturar roteamentos', () => {
  assert.deepEqual(parsePublicStorePath('/mama'), {storeSlug:'mama'})
  assert.deepEqual(parsePublicStorePath('/mama/ana'), {storeSlug:'mama',sellerSlug:'ana'})
  assert.deepEqual(parsePublicStorePath('/mama/catalogo/colares'), {storeSlug:'mama',catalogSlug:'colares'})
  assert.deepEqual(parsePublicStorePath('/mama/ana/colares'), {storeSlug:'mama',sellerSlug:'ana',catalogSlug:'colares'})
})
