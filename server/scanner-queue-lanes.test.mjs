import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {nextScannerJobSql} from './scanner-queue-lanes.mjs'

test('each import class has an exclusive queue lane',()=>{
  const photo=nextScannerJobSql('photos')
  const site=nextScannerJobSql('site')
  const pdf=nextScannerJobSql('pdf')
  assert.match(photo,/google-photos/)
  assert.match(photo,/photos.app.goo.gl/)
  assert.match(site,/NOT/)
  assert.match(pdf,/platform='pdf'/)
  assert.throws(()=>nextScannerJobSql('invalid'),/Lane inválida/)
})

test('existing Mama job in queued/0% is claimed by photos lane without reinserting it', {
  skip: !process.env.DATABASE_URL,
}, async()=>{
  const db=new pg.Client({connectionString:process.env.DATABASE_URL})
  await db.connect()
  try{
    await db.query('BEGIN')
    await db.query(`CREATE TEMP TABLE import_jobs (
      id text PRIMARY KEY,
      status text NOT NULL,
      platform text NOT NULL DEFAULT '',
      source_host text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    ) ON COMMIT DROP`)
    await db.query(`INSERT INTO import_jobs(id,status,platform,source_host,created_at)
      VALUES
        ('slow-site','queued','','old-site.example',now()-interval '10 minutes'),
        ('mama-existing','queued','','photos.app.goo.gl',now()-interval '9 minutes'),
        ('pdf','queued','pdf','photos.app.goo.gl',now()-interval '8 minutes'),
        ('mama-new','queued','google-photos','photos.app.goo.gl',now()-interval '7 minutes'),
        ('standalone-photo','queued','image-link','images.example',now()-interval '6 minutes')
    `)
    const first=await db.query(nextScannerJobSql('photos'))
    assert.equal(first.rows[0]?.id,'mama-existing',
      'old queued Google Photos jobs must be reused and started, not recreated')
    await db.query("UPDATE import_jobs SET status='scanning' WHERE id='mama-existing'")
    assert.equal((await db.query(nextScannerJobSql('photos'))).rows[0]?.id,'mama-new')
    assert.equal((await db.query(nextScannerJobSql('site'))).rows[0]?.id,'slow-site')
    assert.equal((await db.query(nextScannerJobSql('pdf'))).rows[0]?.id,'pdf')
    await db.query("UPDATE import_jobs SET status='scanning' WHERE id='mama-new'")
    assert.equal((await db.query(nextScannerJobSql('photos'))).rows[0]?.id,'standalone-photo')
    assert.equal((await db.query("SELECT count(*)::int AS total FROM import_jobs")).rows[0]?.total,5)
  }finally{
    await db.query('ROLLBACK').catch(()=>{})
    await db.end()
  }
})
