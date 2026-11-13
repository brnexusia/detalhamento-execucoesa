import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const server=readFileSync('server/phase2-operation-hooks.mjs','utf8')
const app=readFileSync('server/app.mjs','utf8')
const ordersUi=readFileSync('src/ShopvaxOrders.tsx','utf8')
const api=readFileSync('src/api.ts','utf8')

test('only authenticated owner may hide a cancelled order, preserving audit metadata',()=>{
  assert.match(server, /app\.delete\('\/api\/admin\/phase2\/orders\/:orderId', requireOwner,/)
  assert.match(server, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz/)
  assert.match(app, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz/)
  assert.match(server, /deleted_by_user_id=\$3/)
  assert.match(server, /CANCEL_FIRST/)
  assert.match(server, /WHERE o\.store_id=\$1 AND o\.deleted_at IS NULL/)
  assert.match(app, /SELECT \* FROM orders WHERE store_id=\$1 AND deleted_at IS NULL/)
  assert.match(api, /hideCancelledOrder:.*\/api\/admin\/phase2\/orders/)
  assert.match(ordersUi, /active\.status==='cancelled'&&<button[^>]*className="svx-orders__delete"/)
  assert.match(ordersUi, /confirmAction\(.*Apagar o talão cancelado/)
})

test('the exact soft-delete SQL rejects active orders, other stores and repeat requests',async()=>{
  assert(process.env.DATABASE_URL,'PostgreSQL DATABASE_URL is required')
  const clause=server.match(/"UPDATE orders SET deleted_at=now\(\),deleted_by_user_id=\$3 WHERE id=\$1 AND store_id=\$2 AND status='cancelled' AND deleted_at IS NULL RETURNING id,code,deleted_at"/)
  assert(clause,'Expected exact SQL expression from API route')
  const sql=clause[0].slice(1,-1)
  const client=new pg.Client({connectionString:process.env.DATABASE_URL})
  await client.connect()
  try{
    await client.query('CREATE TEMP TABLE orders (id text PRIMARY KEY,code text,store_id text NOT NULL,status text NOT NULL,deleted_at timestamptz,deleted_by_user_id text)')
    await client.query(`INSERT INTO orders(id,code,store_id,status) VALUES
       ('cancel-a','A1','store-a','cancelled'),
       ('active-a','A2','store-a','confirmado'),
       ('cancel-b','B1','store-b','cancelled')`)
    const active=await client.query(sql,['active-a','store-a','owner-a'])
    const other=await client.query(sql,['cancel-b','store-a','owner-a'])
    assert.equal(active.rowCount,0,'Cannot hide active orders')
    assert.equal(other.rowCount,0,'Cannot hide another store orders')
    const result=await client.query(sql,['cancel-a','store-a','owner-a'])
    assert.equal(result.rowCount,1)
    assert(result.rows[0].deleted_at)
    const repeat=await client.query(sql,['cancel-a','store-a','owner-a'])
    assert.equal(repeat.rowCount,0,'Already hidden should not be deleted twice')
    const visible=await client.query('SELECT count(*)::int AS n FROM orders WHERE store_id=$1 AND deleted_at IS NULL',['store-a'])
    assert.equal(visible.rows[0].n,1)
    const audit=await client.query('SELECT id,deleted_by_user_id,deleted_at FROM orders WHERE id=$1',['cancel-a'])
    assert.equal(audit.rows[0].deleted_by_user_id,'owner-a')
    assert(audit.rows[0].deleted_at,'Underlying order must be kept for audit')
  }finally {await client.end()}
})
