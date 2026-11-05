import { BlockList, isIP } from 'node:net'

// Only globally routable addresses may be used for server-side requests.
// In particular, IPv4-mapped IPv6, NAT64, 6to4 and documentation ranges
// must not provide an alternate route to private services or metadata.
const blockedV4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedV4.addSubnet(address, prefix, 'ipv4')

const allowedV6 = new BlockList()
allowedV6.addSubnet('2000::', 3, 'ipv6')
const blockedV6 = new BlockList()
for (const [address, prefix] of [
  ['2001::', 32], // Teredo
  ['2001:10::', 28], // ORCHID and related special-purpose range
  ['2001:db8::', 32], // Documentation
  ['2002::', 16], // 6to4: can encode private IPv4 endpoints
]) blockedV6.addSubnet(address, prefix, 'ipv6')

export function isPublicAddress(input) {
  const address = String(input || '').replace(/^\[|\]$/g, '')
  const family = isIP(address)
  if (family === 4) return !blockedV4.check(address, 'ipv4')
  if (family === 6) return allowedV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
  return false
}

export function normalizeOutboundWebhookUrl(input, { allowHttpLocal = false } = {}) {
  const raw = String(input || '').trim()
  if (!raw || raw.length > 2048) return ''
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.hash) return ''
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!host) return ''
    const localDev = allowHttpLocal && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(host)
    if (localDev) return url.toString()
    if (url.protocol !== 'https:' || url.port) return ''
    if (host === 'localhost' || ['.localhost', '.local', '.internal'].some((suffix) => host.endsWith(suffix))) return ''
    if (isIP(host) && !isPublicAddress(host)) return ''
    return url.toString()
  } catch {
    return ''
  }
}
