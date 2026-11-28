import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOrderWhatsappMessage, assertKnownOrderSelections, orderProductDetails } from './order-whatsapp-message.mjs'
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

test('produtos homônimos preservam dados internos sem poluir o romaneio', () => {
  const first = { id: 'calca-1', description: 'Tecido: Crepe', images: ['/media/calca-1'], media_type: 'image' }
  const second = { ...first, id: 'calca-2', images: ['/media/calca-2'] }
  const items = [first, second].map((p,i) => ({ ...item, sku: '', productId: p.id, selections: { Cor: i===0?'Bege':'Preto', Tamanho:'Único' }, ...orderProductDetails(p) }))
  assert.equal(items[0].imageUrl, 'https://shopvax.com.br/media/calca-1')
  assert.equal(items[1].description, 'Tecido: Crepe')
  const result = buildOrderWhatsappMessage({ ...base, order: { ...order, items } })
  assert.match(result, /Cor: Bege\nTamanho: Único/)
  assert.match(result, /Cor: Preto\nTamanho: Único/)
  assert.doesNotMatch(result, /ID:|Descrição:|Foto:|calca-1|calca-2|Tecido: Crepe/)
})
test('foto da combinação selecionada prevalece sobre a galeria base', () => {
  const product = { description: 'Crepe', images: ['/media/base'], variant_images: [{ selections: { Cor: 'Azul' }, images: ['/media/azul'] }, { selections: { Cor: 'Rosa' }, images: ['/media/rosa'] }] }
  assert.equal(orderProductDetails(product, { Cor: 'Rosa' }).imageUrl, 'https://shopvax.com.br/media/rosa')
  assert.equal(orderProductDetails(product, { Cor: 'Verde' }).imageUrl, 'https://shopvax.com.br/media/base')
  assert.equal(orderProductDetails({ media_type: 'video', media_url: '/media/video' }).imageUrl, '')
  assert.equal(orderProductDetails({ images: ['javascript:alert(1)', '//other.test/pic', '/media/safe'] }).imageUrl, 'https://shopvax.com.br/media/safe')
})
test('cupom mantém romaneio enxuto mesmo com descrição e foto persistidas', () => {
  const result = buildOrderWhatsappMessage({ ...base, order: { ...order, items: [{ ...item, productId: 'a', ...orderProductDetails({ description: 'Tamanho único', images: ['/media/a'] }) }] }, subtotal: 140, discount: 10, total: 130, coupon: { code: 'DEZ' } })
  assert.doesNotMatch(result, /ID:|Descrição:|Foto:/)
  assert.match(result, /Valor unitário:/)
  assert.match(result, /Cupom DEZ/)
})
