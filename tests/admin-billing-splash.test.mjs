import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../src/AdminRoute.tsx', import.meta.url), 'utf8')

test('navigating between admin sections does not show subscription-check splash', () => {
  assert.doesNotMatch(route, /Verificando o pagamento da assinatura/i)
  assert.match(route, /if \(billingGate === 'checking'\) return null/)
  assert.doesNotMatch(route, /setBillingGate\('checking'\)/)
})

test('initial panel remains unmounted until backend billing authorization is resolved', () => {
  assert.match(route, /useState<BillingGate>\('checking'\)/)
  assert.match(route, /apiRequest<\{ required: boolean; accessGranted: boolean \}>\('\/api\/billing\/status'\)/)
  assert.match(route, /!result\.required \|\| result\.accessGranted \? 'paid' : 'payment'/)
  assert.match(route, /billingGate === 'payment' && !subscription/)
  assert.match(route, /billingGate === 'anonymous'/)
  assert.match(route, /billingGate === 'unavailable'/)
})

test('navigation still triggers background billing revalidation', () => {
  assert.match(route, /setRevision\(current => current \+ 1\)/)
  assert.match(route, /\}, \[revision\]\)/)
})
