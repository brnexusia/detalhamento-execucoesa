import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePreferences, shouldShowAcquisition, validateSupportInput, validateSupportQuestion, ONBOARDING_CONFIRMABLE } from './onboarding-growth-policy.mjs'

const stores = ['store-a', 'store-b']
test('opt-in explícito por canal; pedido não equivale a consentimento', () => {
  assert.throws(() => normalizePreferences({}, stores), /separadamente/)
  assert.throws(() => normalizePreferences({ whatsapp: true, email: undefined, scope: 'selected', storeIds: ['store-a'] }, stores), /separadamente/)
  assert.deepEqual(normalizePreferences({ whatsapp: true, email: false, scope: 'selected', storeIds: ['store-a'] }, stores), {
    whatsapp: true, email: false, scope: 'selected', storeIds: ['store-a']
  })
})
test('seleção de lojas: listas autorizadas, sem IDs arbitrários', () => {
  assert.throws(() => normalizePreferences({ whatsapp: true, email: false, scope: 'selected', storeIds: ['not-eligible'] }, stores), /indisponíveis/)
  assert.throws(() => normalizePreferences({ whatsapp: false, email: true, scope: 'selected', storeIds: [] }, stores), /Selecione/)
  assert.deepEqual(normalizePreferences({ whatsapp: true, email: true, scope: 'all_current', storeIds: [] }, stores).storeIds, stores)
  assert.deepEqual(normalizePreferences({ whatsapp: true, email: false, scope: 'selected', storeIds: ['store-b', 'store-b'] }, stores).storeIds, ['store-b'])
})
test('descadastro pode zerar ambos os canais sem loja selecionada', () => {
  assert.deepEqual(normalizePreferences({ whatsapp: false, email: false, scope: 'selected', storeIds: [] }, stores).storeIds, [])
})
test('oferta só a visitantes; fechamento retira por sete dias, mas pode reaparecer depois', () => {
  const now = 1_900_000_000_000
  assert.equal(shouldShowAcquisition({ authenticated: true, now }), false)
  assert.equal(shouldShowAcquisition({ authenticated: false, now }), true)
  assert.equal(shouldShowAcquisition({ authenticated: false, now, closedAt: now - 1000 }), false)
  assert.equal(shouldShowAcquisition({ authenticated: false, now, closedAt: now - 8 * 86400000 }), true)
})
test('suporte exige propósito, texto proporcional e ciência da coleta', () => {
  const good = { audience: 'buyer', topic: 'order', message: 'Meu pedido aparece no histórico, mas ainda preciso de ajuda.', replyEmail: 'buyer@example.test', privacyAcknowledged: true }
  assert.equal(validateSupportInput(good).topic, 'order')
  assert.throws(() => validateSupportInput({ ...good, privacyAcknowledged: false }), /Confirme/)
  assert.throws(() => validateSupportInput({ ...good, message: 'oi' }), /15/)
  assert.throws(() => validateSupportInput({ ...good, topic: 'discounts' }), /assunto/)
  assert.throws(() => validateSupportInput({ ...good, replyEmail: 'invalido' }), /E-mail/)
})
test('somente etapas explicitamente confirmáveis podem ser registradas', () => {
  assert.deepEqual([...ONBOARDING_CONFIRMABLE], ['minimum_reviewed', 'preview_opened', 'whatsapp_understood'])
  assert.equal(ONBOARDING_CONFIRMABLE.has('seller_created'), false)
})

test('assistência IA bloqueia identificadores e exige ciência voluntária', () => {
  const sample = { audience:'buyer',topic:'order',question:'Como preparo um talão para a vendedora?',privacyAcknowledged:true }
  assert.equal(validateSupportQuestion(sample).topic,'order')
  assert.throws(()=>validateSupportQuestion({...sample,question:'Contate eu@exemplo.com'}),/Não envie/)
  assert.throws(()=>validateSupportQuestion({...sample,question:'Meu telefone 5511989999999'}),/Não envie/)
  assert.throws(()=>validateSupportQuestion({...sample,privacyAcknowledged:false}),/Confirme/)
  assert.throws(()=>validateSupportQuestion({...sample,question:'oi'}),/8 e 600/)
  assert.throws(()=>validateSupportQuestion({...sample,topic:'financial-advice'}),/Assunto/)
})
