import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidBuyerDocument, normalizeBuyerDocument } from './buyer-document.mjs'

test('CPF é validado pelos dois dígitos verificadores', () => {
  assert.equal(normalizeBuyerDocument('529.982.247-25'), '52998224725')
  assert.equal(isValidBuyerDocument('529.982.247-25'), true)
  assert.equal(isValidBuyerDocument('52998224726'), false)
  assert.equal(isValidBuyerDocument('11111111111'), false)
  assert.equal(isValidBuyerDocument(''), false)
})

test('CNPJ numérico antigo continua aceito', () => {
  assert.equal(normalizeBuyerDocument('04.252.011/0001-10'), '04252011000110')
  assert.equal(isValidBuyerDocument('04.252.011/0001-10'), true)
  assert.equal(isValidBuyerDocument('04.252.011/0001-11'), false)
  assert.equal(isValidBuyerDocument('00000000000000'), false)
})

test('novo CNPJ alfanumérico de 2026 aceita letras e verifica os dígitos finais', () => {
  // Exemplo de primeiro CNPJ alfanumérico divulgado oficialmente pela Receita Federal.
  assert.equal(normalizeBuyerDocument('00.000.000/E08G-12'), '00000000E08G12')
  assert.equal(isValidBuyerDocument('00.000.000/E08G-12'), true)
  assert.equal(isValidBuyerDocument('00000000E08G13'), false)
  assert.equal(isValidBuyerDocument('00000000E08G1A'), false)
  assert.equal(isValidBuyerDocument('00000000E08G'), false)
})

test('CPF e CNPJ não devem aceitar números curtos, formatos incompletos ou dados inválidos', () => {
  for (const bad of ['00000000000','12345678901','123','1234567890123','ABCDEFGH123456',
    '11111111111111','00000000000001','99999999999999']) {
    assert.equal(isValidBuyerDocument(bad), false, bad)
  }
})
