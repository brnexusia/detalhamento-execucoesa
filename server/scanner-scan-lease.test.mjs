import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { requeueInterruptedScans, retryInterruptedScan } from './scanner-scan-lease.mjs'

test('scanner lease: requeue only orphaned jobs after a crash, never live jobs', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = new pg.Client({ connectionString:process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query(`
      CREATE TEMP TABLE import_jobs(
        id text PRIMARY KEY,
        status text NOT NULL,
        progress integer NOT NULL,
        result_count integer NOT NULL,
        pages_scanned integer NOT NULL,
        error text NOT NULL,
        scan_worker_token text,
        scan_lease_at timestamptz,
        updated_at timestamptz NOT NULL
      ) ON COMMIT DROP
    `)
    await db.query(`
      INSERT INTO import_jobs
        (id,status,progress,result_count,pages_scanned,error,scan_worker_token,scan_lease_at,updated_at)
      VALUES
        ('orphan-new','scanning',54,360,391,'','dead','2020-01-01T00:00:00Z',now()),
        ('live-worker','scanning',54,360,391,'','active',now(),'2020-01-01T00:00:00Z'),
        ('orphan-legacy','scanning',54,360,391,'',NULL,NULL,'2020-01-01T00:00:00Z'),
        ('new-legacy','scanning',54,360,391,'',NULL,NULL,now()),
        ('already-processing','processing',95,360,391,'','old','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')
    `)
    const recovered = await requeueInterruptedScans(db.query.bind(db))
    assert.deepEqual(recovered.map(x=>x.id).sort(),['orphan-legacy','orphan-new'])
    const rows = (await db.query('SELECT * FROM import_jobs ORDER BY id')).rows
    assert.equal(rows.find(x=>x.id==='live-worker').status,'scanning')
    assert.equal(rows.find(x=>x.id==='new-legacy').status,'scanning')
    assert.equal(rows.find(x=>x.id==='already-processing').status,'processing')
    for (const key of ['orphan-legacy','orphan-new']) {
      const row=rows.find(x=>x.id===key)
      assert.equal(row.status,'queued')
      assert.equal(row.progress,0)
      assert.equal(row.result_count,0)
      assert.equal(row.pages_scanned,0)
      assert.equal(row.scan_worker_token,null)
      assert.equal(row.scan_lease_at,null)
    }
    assert.deepEqual(await requeueInterruptedScans(db.query.bind(db)),[],
      'Recovered jobs must not requeue twice')
  } finally {
    await db.query('ROLLBACK').catch(()=>{})
    await db.end()
  }
})

test('store-scoped one-click scanner retry does not affect live jobs or other stores', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = new pg.Client({ connectionString:process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query(`
      CREATE TEMP TABLE import_jobs(
        id text PRIMARY KEY,
        store_id text NOT NULL,
        status text NOT NULL,
        progress integer NOT NULL,
        result_count integer NOT NULL,
        pages_scanned integer NOT NULL,
        error text NOT NULL,
        scan_worker_token text,
        scan_lease_at timestamptz,
        updated_at timestamptz NOT NULL
      ) ON COMMIT DROP
    `)
    await db.query(`
      INSERT INTO import_jobs
        (id,store_id,status,progress,result_count,pages_scanned,error,scan_worker_token,scan_lease_at,updated_at)
      VALUES
        ('target','galego','scanning',54,360,391,'','expired','2020-01-01T00:00:00Z',now()),
        ('other-store','outro','scanning',54,360,391,'','expired','2020-01-01T00:00:00Z',now()),
        ('active','galego','scanning',54,360,391,'','active',now(),'2020-01-01T00:00:00Z')
    `)
    assert.equal(await retryInterruptedScan(db.query.bind(db),{jobId:'other-store',storeId:'galego'}),null)
    assert.equal(await retryInterruptedScan(db.query.bind(db),{jobId:'active',storeId:'galego'}),null)
    const recovered=await retryInterruptedScan(db.query.bind(db),{jobId:'target',storeId:'galego'})
    assert.deepEqual(recovered,{id:'target'})
    assert.equal(await retryInterruptedScan(db.query.bind(db),{jobId:'target',storeId:'galego'}),null,
      'A second click must never restart the queued scan')
    const rows=(await db.query('SELECT * FROM import_jobs ORDER BY id')).rows
    assert.equal(rows.find(r=>r.id==='target').status,'queued')
    assert.equal(rows.find(r=>r.id==='target').progress,0)
    assert.equal(rows.find(r=>r.id==='other-store').status,'scanning')
    assert.equal(rows.find(r=>r.id==='active').status,'scanning')
  } finally {
    await db.query('ROLLBACK').catch(()=>{})
    await db.end()
  }
})
