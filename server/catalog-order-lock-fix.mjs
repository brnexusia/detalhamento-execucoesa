import pg from 'pg'

const { Client } = pg
const originalQuery = Client.prototype.query

Client.prototype.query = function catalogOrderLockFix(config, values, callback) {
  if (typeof config === 'string' && config.includes('FROM products p LEFT JOIN catalog_products cp') && config.includes('ORDER BY p.id FOR UPDATE') && !config.includes('FOR UPDATE OF p')) {
    config = config.replace('ORDER BY p.id FOR UPDATE', 'ORDER BY p.id FOR UPDATE OF p')
  } else if (config && typeof config === 'object' && typeof config.text === 'string' && config.text.includes('FROM products p LEFT JOIN catalog_products cp') && config.text.includes('ORDER BY p.id FOR UPDATE') && !config.text.includes('FOR UPDATE OF p')) {
    config = { ...config, text: config.text.replace('ORDER BY p.id FOR UPDATE', 'ORDER BY p.id FOR UPDATE OF p') }
  }
  return originalQuery.call(this, config, values, callback)
}
