import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBuyerPhone, buyerWhatsappReady } from './buyer-whatsapp-auth-hooks.mjs'

test('normaliza telefone brasileiro em formato internacional brasileiro', () => {
  assert.equal(normalizeBuyerPhone('(71) 99999-9999'), '5571999999999')
  assert.equal(normalizeBuyerPhone('5571999999999'), '5571999999999')
  assert.equal(normalizeBuyerPhone('(11) 3333-4444'), '551133334444')
  assert.equal(normalizeBuyerPhone(''), null)
  assert.equal(normalizeBuyerPhone('123'), null)
  assert.equal(normalizeBuyerPhone('44123456789'), null)
})

test('login não fica habilitado sem configuração completa da central e segredo forte', () => {
  assert.equal(buyerWhatsappReady(), false)
})
