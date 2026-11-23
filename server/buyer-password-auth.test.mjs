import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hashBuyerPassword, verifyBuyerPassword } from './buyer-password-auth.mjs'

test('senha de comprador usa scrypt com salt único e comparação segura', async()=>{
  const password='Senha-forte-de-cadastro-2026!'
  const a=await hashBuyerPassword(password)
  const b=await hashBuyerPassword(password)
  assert.notEqual(a,b,'cada conta deve ter salt próprio')
  assert.match(a,/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  assert.equal(await verifyBuyerPassword(password,a),true)
  assert.equal(await verifyBuyerPassword('Senha errada 2026!',a),false)
  assert.equal(await verifyBuyerPassword(password,'invalid'),false)
  assert.equal(await verifyBuyerPassword(password,''),false)
  await assert.rejects(hashBuyerPassword('fraca'),/10 a 128/)
})

test('novo cadastro não sobrescreve contas antigas nem concede propriedade do telefone',()=>{
  const source=readFileSync(new URL('./buyer-password-auth.mjs',import.meta.url),'utf8')
  const buyer=readFileSync(new URL('./buyer-whatsapp-auth-hooks.mjs',import.meta.url),'utf8')
  assert.match(source,/INSERT INTO buyer_accounts\(id,phone,name,document,cnpj,cnpj_status,profile_completed,phone_verified\)/)
  assert.match(source,/VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,true,false\)/)
  assert.doesNotMatch(source,/ON CONFLICT\(phone\) DO UPDATE/)
  assert.match(buyer,/const legacy = account\.phone_verified/)
  assert.match(buyer,/buyerPasswordLoginEnabled|buyerAuthReady|buyer_password_credentials/)
  assert.match(source,/pg_advisory_xact_lock/)
  assert.match(source,/created_at>now\(\)-interval '1 hour'/)
  assert.match(source,/sameSite|cookieOptions\(req\)/)
  assert.match(source,/register-password/)
  assert.match(source,/login-password/)
})

test('verificação WhatsApp continua opcional, enquanto sessão por senha funciona sem UAZAPI',()=>{
  const source=readFileSync(new URL('./buyer-whatsapp-auth-hooks.mjs',import.meta.url),'utf8')
  assert.match(source,/export const buyerAuthReady = \(\) => Boolean\(pool\)/)
  assert.match(source,/enabled:buyerAuthReady\(\),mode:'password'/)
  assert.match(source,/installBuyerPasswordRoutes\(app/)
  assert.match(source,/currentSocialBuyer\(req\) \{\n  if \(!buyerAuthReady\(\)/)
  assert.match(source,/async function me\(req,res\) \{\n  if \(!buyerAuthReady\(\)/)
  assert.match(source,/buyerPasswordCredentials|buyer_password_credentials/)
})
