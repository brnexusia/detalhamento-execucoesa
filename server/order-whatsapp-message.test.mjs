import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOrderWhatsappMessage, assertKnownOrderSelections } from './order-whatsapp-message.mjs'
const base = { store: { name: 'Look Premium' }, seller: { name: 'Chang' }, catalog: { name: 'Catálogo geral' }, total: 280 }
const item = { name: 'CALÇA DOMINIQUE', sku: 'CD1', quantity: 2, unitPrice: 70, lineTotal: 140 }
const order = { code: 'AS-TEST', items: [{ ...item, selections: { Cor: 'Preto', Tamanho: 'M', Tecido: 'Linho' } }, { ...item, selections: { Cor: 'Branco', Tamanho: 'G' } }], buyer: { name: 'Cliente', city: 'Salvador', cep: '40000000', phone: '71999999999' }, notes: 'Retirar na loja' }
test('preserva cada combinação, referência, quantidade, preço e dados do comprador', () => {
  const result = buildOrderWhatsappMessage({ ...base, order })
  assert.match(result, /2x CALÇA DOMINIQUE\*\nRef\.: CD1\nCor: Preto\nTamanho: M\nTecido: Linho/)
  assert.match(result, /2x CALÇA DOMINIQUE\*\nRef\.: CD1\nCor: Branco\nTamanho: G/)
  assert.match(result, /Valor unitário: R\$\s70,00/)
  assert.match(result, /Total dos produtos: R\$\s280,00/)
  for (const value of ['Comprador: Cliente', 'Cidade: Salvador', 'CEP: 40000000', 'Contato: 71999999999', 'Observações: Retirar na loja']) assert.ok(result.includes(value))
})
test('cupom mantém variações e observações; caixa informa quantidade física', () => {
  const result = buildOrderWhatsappMessage({ ...base, order: { ...order, items: [{ ...order.items[0], unitsPerBox: 6, stockUnits: 12 }] }, subtotal: 140, discount: 10, total: 130, coupon: { code: 'DEZ' } })
  for (const value of ['Cor: Preto', 'Tamanho: M', 'Unidades por caixa: 6', 'Total de unidades: 12', 'Observações: Retirar na loja']) assert.ok(result.includes(value))
  assert.match(result, /Cupom DEZ: -R\$\s10,00/)
})
test('produto sem variação não inventa cor ou tamanho; seleção perdida é rejeitada', () => {
  const result = buildOrderWhatsappMessage({ ...base, order: { code: 'AS-2', items: [{ ...item, selections: {} }] } })
  assert.doesNotMatch(result, /Cor:|Tamanho:/)
  assert.doesNotThrow(() => assertKnownOrderSelections(item, { Cor: 'Preto' }, { Cor: 'Preto' }))
  assert.throws(() => assertKnownOrderSelections(item, { Cor: 'Preto' }, {}), /Atualize o carrinho/)
})
