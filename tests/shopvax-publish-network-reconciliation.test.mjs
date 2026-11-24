import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../src/ScannerPublishModule.tsx', import.meta.url), 'utf8')
const queue = readFileSync(new URL('../server/scanner-publish-progress.mjs', import.meta.url), 'utf8')

test('lost response to POST is reconciled by GET, not a second POST', () => {
  const publish = ui.slice(ui.indexOf('  const publish = async (job: Job) => {'), ui.indexOf('  const activeProgress ='))
  assert.match(publish, /connectionLost[\s\S]*?pendingConfirmationPolls\.current\.set\(job\.id, 0\)/)
  assert.match(publish, /const recovered = await loadPublishProgress\(job\.id\)/)
  assert.match(publish, /recovered\.catalogId === catalogId/)
  assert.equal((publish.match(/method:'POST'/g) || []).length, 1, 'network recovery must never POST again')
})

test('uncertain publish is locked until status is positively confirmed', () => {
  assert.match(ui, /Boolean\(pendingConfirmation\[job\.id\]\)/)
  assert.match(ui, /pendingConfirmation\[job\.id\] \? 'Confirmando no servidor…'/)
  const check = ui.slice(ui.indexOf('  const loadPublishProgress ='), ui.indexOf('  useEffect(()=>{', ui.indexOf('  const loadPublishProgress =')))
  assert.match(check, /if \(checks >= 2\)/)
  assert.match(check, /pendingConfirmationPolls\.current\.set\(jobId, checks \+ 1\)/)
  assert.match(check, /return null[\s\S]*?const progress=payload\.progress/)
  assert.match(check, /catch \{[\s\S]*?return null/)
})

test('backend persists one task per import and does not restart finished or running work', () => {
  assert.match(queue, /job_id text PRIMARY KEY REFERENCES import_jobs/)
  assert.match(queue, /ON CONFLICT\(job_id\) DO UPDATE SET/)
  assert.match(queue, /WHERE import_publish_tasks\.state='failed'/)
  assert.match(queue, /RETURNING \*/)
})
