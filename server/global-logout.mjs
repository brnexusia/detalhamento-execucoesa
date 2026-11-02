import crypto from 'node:crypto'

// A single browser may have owner, WhatsApp buyer and legacy customer cookies.
// Logout revokes *all* existing server sessions before dropping the cookies.
export const browserSessionCookies = ['atacado_session', 'shopvax_buyer_session', 'shopvax_customer_session']

const tokenHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')

export async function revokeAllBrowserSessions(pool, cookies = {}) {
  const ownerToken = cookies.atacado_session
  const buyerToken = cookies.shopvax_buyer_session
  const legacyToken = cookies.shopvax_customer_session
  if (!ownerToken && !buyerToken && !legacyToken) return
  if (!pool) throw new Error('Banco indisponível para revogação das sessões.')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (ownerToken) {
      await client.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(ownerToken)])
    }
    if (buyerToken || legacyToken) {
      // A conta WhatsApp e as contas antigas são opcionais em instalações anteriores.
      const result = await client.query(
        "SELECT to_regclass('public.buyer_sessions') AS buyer_sessions, to_regclass('public.store_customer_sessions') AS store_customer_sessions",
      )
      const tables = result.rows[0] || {}
      if (buyerToken && tables.buyer_sessions) {
        await client.query('DELETE FROM buyer_sessions WHERE token_hash=$1', [tokenHash(buyerToken)])
      }
      if (legacyToken && tables.store_customer_sessions) {
        await client.query('DELETE FROM store_customer_sessions WHERE token_hash=$1', [tokenHash(legacyToken)])
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* Preserve original error. */ }
    throw error
  } finally {
    client.release()
  }
}

export function clearAllBrowserSessionCookies(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  for (const cookie of browserSessionCookies) {
    res.clearCookie(cookie, { httpOnly: true, sameSite: 'lax', secure, path: '/' })
  }
}
