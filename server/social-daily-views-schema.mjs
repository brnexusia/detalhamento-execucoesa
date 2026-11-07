/**
 * Social reach: one product view per anonymous visitor per Brazil-local day.
 * The original social_post_views table had a lifetime PK (product_id, visitor_key).
 * Do not mutate that historical table, or erase earlier metrics. Migrate each
 * existing view into the daily table once under a transaction advisory lock.
 */
const DAILY_ZONE = 'America/Sao_Paulo'
let schemaPromise = null

export const dailySocialViewInsertSQL = `
  INSERT INTO social_post_daily_views (product_id,store_id,visitor_key,view_day)
  VALUES ($1,$2,$3,(now() AT TIME ZONE '${DAILY_ZONE}')::date)
  ON CONFLICT (product_id,visitor_key,view_day) DO NOTHING
`

export async function ensureSocialDailyViews(pool) {
  if (!schemaPromise) {
    schemaPromise = migrate(pool).catch(error => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function migrate(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Multiple API processes may start at once; only one performs the backfill.
    await client.query('SELECT pg_advisory_xact_lock(20261107, 5101)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS social_post_daily_views (
        product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        visitor_key text NOT NULL,
        view_day date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(product_id,visitor_key,view_day)
      );
      CREATE INDEX IF NOT EXISTS idx_social_daily_views_store
        ON social_post_daily_views(store_id,view_day DESC);
      CREATE TABLE IF NOT EXISTS shopvax_schema_migrations (
        key text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    const marker = await client.query(
      'SELECT key FROM shopvax_schema_migrations WHERE key=$1',
      ['social_post_daily_views_backfill_v1'],
    )
    if (!marker.rowCount) {
      await client.query(`
        INSERT INTO social_post_daily_views
          (product_id,store_id,visitor_key,view_day,created_at)
        SELECT product_id,store_id,visitor_key,
          (created_at AT TIME ZONE '${DAILY_ZONE}')::date,
          MIN(created_at)
        FROM social_post_views
        GROUP BY product_id,store_id,visitor_key,
          (created_at AT TIME ZONE '${DAILY_ZONE}')::date
        ON CONFLICT (product_id,visitor_key,view_day) DO NOTHING
      `)
      await client.query(
        'INSERT INTO shopvax_schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING',
        ['social_post_daily_views_backfill_v1'],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
