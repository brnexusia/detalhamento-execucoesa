import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicAddress, normalizeOutboundWebhookUrl } from './network-egress-policy.mjs'

test('egress policy accepts public IPs, not private, mapped, or transition addresses', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(ip), true, ip)
  }
  for (const ip of [
    '127.0.0.1', '10.10.10.10', '100.64.1.1', '169.254.169.254',
    '172.20.1.1', '192.168.1.1', '192.0.2.1', '198.51.100.10',
    '203.0.113.2', '0.0.0.0', '::1', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe',
    '2001:db8::1', '2002:0a00:0001::1', 'fc00::1', 'fe80::1', 'ff02::1',
  ]) assert.equal(isPublicAddress(ip), false, ip)
})

test('ERP webhook URLs reject credentials, internal services and unsafe ports', () => {
  assert.equal(normalizeOutboundWebhookUrl('https://example.com/hook'), 'https://example.com/hook')
  for (const input of [
    'http://example.com/hook', 'https://localhost/hook',
    'https://127.0.0.1/', 'https://169.254.169.254/',
    'https://[::ffff:7f00:1]/', 'https://intranet.internal/hook',
    'https://example.com:8443/', 'https://user:secret@example.com/',
    'https://example.com/hook#fragment', 'file:///etc/passwd',
  ]) assert.equal(normalizeOutboundWebhookUrl(input), '', input)
  assert.equal(normalizeOutboundWebhookUrl('http://127.0.0.1:9/shopvax-hook', { allowHttpLocal: true }), 'http://127.0.0.1:9/shopvax-hook')
  assert.equal(normalizeOutboundWebhookUrl('http://127.0.0.1:9/shopvax-hook'), '')
})
