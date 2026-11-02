import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeBuyerPhone, buyerWhatsappReady } from './buyer-whatsapp-auth-hooks.mjs'
import {
  buildBuyerVerificationMessage,
  buyerWhatsappDeliveryConfigured,
  deliverBuyerVerificationCode,
} from './buyer-whatsapp-delivery.mjs'

test('normaliza telefone brasileiro em formato internacional brasileiro', () => {
  assert.equal(normalizeBuyerPhone('(71) 99999-9999'), '5571999999999')
  assert.equal(normalizeBuyerPhone('5571999999999'), '5571999999999')
  assert.equal(normalizeBuyerPhone('(11) 3333-4444'), '551133334444')
  assert.equal(normalizeBuyerPhone(''), null)
  assert.equal(normalizeBuyerPhone('123'), null)
  assert.equal(normalizeBuyerPhone('+44123456789'), null)
})

test('login não fica habilitado sem configuração completa da central e segredo forte', () => {
  assert.equal(buyerWhatsappReady(), false)
})

test('login só fica pronto quando flag, entrega e segredo HMAC estão completos', () => {
  const keys = ['SHOPVAX_BUYER_WHATSAPP_LOGIN', 'UAZAPI_BASE_URL', 'UAZAPI_INSTANCE_TOKEN', 'SHOPVAX_OTP_HMAC_SECRET']
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    process.env.SHOPVAX_BUYER_WHATSAPP_LOGIN = '1'
    process.env.UAZAPI_BASE_URL = 'https://uazapi.test'
    process.env.UAZAPI_INSTANCE_TOKEN = 'token-de-teste'
    process.env.SHOPVAX_OTP_HMAC_SECRET = 'segredo-hmac-de-teste-com-mais-de-32-caracteres'
    assert.equal(buyerWhatsappReady(), true)
    process.env.UAZAPI_BASE_URL = 'http://uazapi.test'
    assert.equal(buyerWhatsappReady(), false)
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test('segredo estável de integração pode derivar OTP isolado quando não há chave dedicada', () => {
  const keys = ['SHOPVAX_BUYER_WHATSAPP_LOGIN', 'UAZAPI_BASE_URL', 'UAZAPI_INSTANCE_TOKEN', 'SHOPVAX_OTP_HMAC_SECRET', 'SHOPVAX_INTEGRATION_SECRET']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    process.env.SHOPVAX_BUYER_WHATSAPP_LOGIN = '1'
    process.env.UAZAPI_BASE_URL = 'https://central.test'
    process.env.UAZAPI_INSTANCE_TOKEN = 'token-de-teste'
    delete process.env.SHOPVAX_OTP_HMAC_SECRET
    process.env.SHOPVAX_INTEGRATION_SECRET = 'chave-estavel-de-integracao-com-mais-de-32-caracteres'
    assert.equal(buyerWhatsappReady(), true)
    process.env.SHOPVAX_INTEGRATION_SECRET = 'fraca'
    assert.equal(buyerWhatsappReady(), false)
    process.env.SHOPVAX_INTEGRATION_SECRET = 'chave-estavel-de-integracao-com-mais-de-32-caracteres'
    process.env.SHOPVAX_BUYER_WHATSAPP_LOGIN = '0'
    assert.equal(buyerWhatsappReady(), false, 'flag de ativação permanece obrigatória')
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})

test('configuração de entrega exige HTTPS e token sem expor exceções de URL', () => {
  assert.equal(buyerWhatsappDeliveryConfigured({ UAZAPI_BASE_URL: 'http://uazapi.test', UAZAPI_INSTANCE_TOKEN: 'token' }), false)
  assert.equal(buyerWhatsappDeliveryConfigured({ UAZAPI_BASE_URL: 'não-é-url', UAZAPI_INSTANCE_TOKEN: 'token' }), false)
  assert.equal(buyerWhatsappDeliveryConfigured({ UAZAPI_BASE_URL: 'https://uazapi.test', UAZAPI_INSTANCE_TOKEN: '' }), false)
  assert.equal(buyerWhatsappDeliveryConfigured({ UAZAPI_BASE_URL: 'https://uazapi.test', UAZAPI_INSTANCE_TOKEN: 'token' }), true)
})

test('mensagem de confirmação contém código, validade e alerta de segurança', () => {
  assert.equal(
    buildBuyerVerificationMessage('042731'),
    'ShopVax: seu código de verificação é 042731. Válido por 5 minutos. Não compartilhe.',
  )
  assert.throws(() => buildBuyerVerificationMessage('12345'), /Código de verificação inválido/)
})

test('envio usa contrato UAZAPI, rastreamento próprio e aguarda resposta síncrona', async () => {
  let captured
  const result = await deliverBuyerVerificationCode({
    phone: '5571999999999',
    code: '042731',
    trackingId: '0f4c20c0-90aa-46bb-b465-715b2a7651f6',
    baseUrl: 'https://uazapi.test/root',
    token: 'token-de-teste',
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) }
      return { ok: true, status: 200 }
    },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(captured.url, 'https://uazapi.test/send/text')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers.token, 'token-de-teste')
  assert.deepEqual(captured.body, {
    number: '5571999999999',
    text: 'ShopVax: seu código de verificação é 042731. Válido por 5 minutos. Não compartilhe.',
    track_source: 'shopvax_auth',
    track_id: '0f4c20c0-90aa-46bb-b465-715b2a7651f6',
    async: false,
  })
})

test('falhas e timeout do provedor retornam erro seguro sem resposta ou credencial', async () => {
  const common = {
    phone: '5571999999999', code: '042731', trackingId: 'tracking-12345678',
    baseUrl: 'https://uazapi.test', token: 'segredo-que-nao-pode-vazar',
  }
  await assert.rejects(
    deliverBuyerVerificationCode({ ...common, fetchImpl: async () => ({ ok: false, status: 502 }) }),
    (error) => error.code === 'PROVIDER_REJECTED' && !error.message.includes(common.token),
  )
  await assert.rejects(
    deliverBuyerVerificationCode({
      ...common,
      timeoutMs: 10,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
    }),
    (error) => error.code === 'DELIVERY_TIMEOUT' && !error.message.includes(common.token),
  )
})

test('bootstrap do backend e da imagem Docker carrega efetivamente a autenticação do comprador', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
  const modulePath = './server/buyer-whatsapp-auth-hooks.mjs'
  assert.equal(packageJson.scripts.start.split(modulePath).length - 1, 1, 'npm start deve registrar o módulo uma vez')
  assert.equal(dockerfile.split('"' + modulePath + '"').length - 1, 1, 'Docker CMD deve registrar o módulo uma vez')
})

test('OTP é gerado e verificado somente no servidor, sem devolver código ao navegador', () => {
  const server = readFileSync(new URL('./buyer-whatsapp-auth-hooks.mjs', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/BuyerWhatsappLogin.tsx', import.meta.url), 'utf8')
  assert.match(server, /crypto\.randomInt\(0, 1000000\)/)
  assert.match(server, /code_mac/)
  assert.match(server, /now\(\)\+interval '5 minutes'/)
  assert.match(server, /crypto\.timingSafeEqual/)
  assert.match(server, /consumed_at=now\(\)/)
  assert.match(server, /expiresInSeconds: 300/)
  assert.doesNotMatch(server, /res\.json\(\{[^}]*\bcode\b/s, 'resposta HTTP não pode revelar o OTP')
  assert.doesNotMatch(client, /UAZAPI_INSTANCE_TOKEN|SHOPVAX_OTP_HMAC_SECRET|UAZAPI_BASE_URL/)
})

test('cadastro por WhatsApp é global e a associação à loja só ocorre por ação comercial', () => {
  const auth = readFileSync(new URL('./buyer-whatsapp-auth-hooks.mjs', import.meta.url), 'utf8')
  const orders = readFileSync(new URL('./phase2-operation-hooks.mjs', import.meta.url), 'utf8')
  const social = readFileSync(new URL('./social-network-hooks.mjs', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const login = readFileSync(new URL('../src/BuyerWhatsappLogin.tsx', import.meta.url), 'utf8')
  const choice = readFileSync(new URL('../src/SocialAccountChoice.tsx', import.meta.url), 'utf8')
  assert.match(auth, /phone text UNIQUE NOT NULL/, 'identidade única é o telefone verificado')
  assert.match(auth, /req\.body\?\.storeSlug && !await store\(/, 'contexto de loja não pode ser obrigatório no OTP')
  assert.match(auth, /if \(!createIfMissing\)/, 'consulta de perfil não deve criar cliente da loja')
  assert.match(orders, /currentCustomer\(req, store\.id, false\)/)
  assert.doesNotMatch(login, /JSON\.stringify\(\{ phone, storeSlug \}\)/)
  assert.match(app, /pathname === '\/comprador'/)
  assert.match(choice, /Você é loja ou comprador\?/)
  assert.match(social, /x-shopvax-follow-role/, 'seguir respeita a identidade escolhida')
})

test('resposta após OTP válido conserva o identificador do comprador fora da transação', () => {
  const source = readFileSync(new URL('./buyer-whatsapp-auth-hooks.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function verifyCode(req, res) {')
  const end = source.indexOf('\nfunction profileFields(', start)
  assert.ok(start >= 0 && end > start, 'handler de verificação deve existir')
  const handler = source.slice(start, end)
  const declaration = handler.indexOf('const createdId = uuid()')
  const transactionStart = handler.indexOf('try {')
  const response = handler.indexOf('created: account.id === createdId')
  assert.ok(declaration > 0 && declaration < transactionStart,
    'createdId precisa estar no mesmo escopo que a resposta, e não apenas dentro do try')
  assert.ok(response > handler.indexOf("await client.query('COMMIT')"),
    'a resposta precisa informar corretamente se a conta foi criada após o commit')
  assert.equal(handler.split('const createdId = uuid()').length - 1, 1,
    'não criar identificadores diferentes ao montar a resposta')
})
