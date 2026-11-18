/**
 * Full running application regression for a seller's existing Google Photos
 * import stuck in "Aguardando scanner 0%". Nothing touches production:
 * CI starts two sequential ShopVax processes against isolated PostgreSQL.
 *
 * 1. Worker disabled: create a normal seller and an import, verify 0% queued.
 * 2. Restart worker enabled: verify the SAME id transitions out of queued
 *    without clicking Import again, and verify the state via the real API.
 *
 * Only a deliberately invalid public album URL is used. Network/OCR are not
 * needed to prove the job was picked up. No product is published.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import pg from 'pg'

const base = 'http://127.0.0.1:3029'
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2})
const children=[]
const fd=openSync('/tmp/scanner-real-worker-app.log','a')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function request(url,opts={}) {
  const res=await fetch(base+url,{...opts,signal:AbortSignal.timeout(2500)})
  const text=await res.text()
  let parsed
  try{parsed=JSON.parse(text)}catch{parsed={body:text.slice(0,600)}}
  return {status:res.status,data:parsed,cookie:res.headers.get('set-cookie')}
}
async function startServer(disabled) {
  const child=spawn('npm',['start'],{
    detached:true,
    cwd:process.cwd(),
    env:{...process.env,PORT:'3029',SCANNER_WORKER_DISABLED:disabled?'1':'0'},
    stdio:['ignore',fd,fd],
  })
  children.push(child)
  let ready=false
  for(let i=0;i<160;i++){
    try {
      const health=await request('/health')
      if(health.status===200&&health.data.database===true){ready=true;break}
    }catch{}
    await sleep(250)
  }
  assert.equal(ready,true,'Application database/HTTP never became healthy (see scanner-real-worker-app.log)')
  return child
}
async function stopServer(child){
  if(!child)return
  try{process.kill(-child.pid,'SIGTERM')}catch{}
  for(let i=0;i<20;i++){
    try{await request('/health')}catch{return}
    await sleep(100)
  }
  try{process.kill(-child.pid,'SIGKILL')}catch{}
  await sleep(500)
}

try{
  const stopped=await startServer(true)
  const account=await request('/api/auth/register',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({
      name:'Scanner CI',email:'scanner-'+crypto.randomUUID()+'@example.test',
      password:'ci-scanner-2026',
      storeName:'Mama CI Test',
      whatsapp:'5511999999999',planCode:'bronze',
    })
  })
  assert.equal(account.status,201,JSON.stringify(account.data))
  const cookie=account.cookie?.split(';')[0]
  assert.ok(cookie,'Missing session cookie from ShopVax registration')
  const headers={'content-type':'application/json',Cookie:cookie}
  const source='https://photos.app.goo.gl/nonexistent-ci-scanner-album'
  const created=await request('/api/admin/imports',{
    method:'POST',headers,
    body:JSON.stringify({url:source}),
  })
  assert.equal(created.status,201,JSON.stringify(created.data))
  assert.equal(created.data.job.status,'queued')
  const id=created.data.job.id
  const first=await request('/api/admin/imports',{headers:{Cookie:cookie}})
  assert.equal(first.status,200)
  assert.equal(first.data.scanner.localWorkerEnabled,false)
  assert.equal(first.data.jobs.find(j=>j.id===id)?.status,'queued')
  // An older deployed build created Photo jobs with platform=''. Test exact
  // backward compatibility against an import already waiting in the queue.
  const updated=await db.query("UPDATE import_jobs SET platform='' WHERE id=$1 AND status='queued'",[id])
  assert.equal(updated.rowCount,1)
  await stopServer(stopped)
  const started=await startServer(false)
  let transitioned
  let lastState
  for(let i=0;i<160;i++){
    const item=await request('/api/admin/imports',{headers:{Cookie:cookie}})
    assert.equal(item.status,200)
    lastState=item.data.scanner
    const job=item.data.jobs.find(j=>j.id===id)
    assert.ok(job,'existing job was deleted after restart')
    if(job.status!=='queued'){transitioned=job;break}
    await sleep(250)
  }
  assert.ok(transitioned,
    'Existing Mama Google Photos import remained queued despite worker enabled: '+JSON.stringify(lastState))
  assert.ok(['scanning','processing','review','failed'].includes(transitioned.status),
    'unexpected state after worker claim: '+transitioned.status)
  assert.equal(lastState.localWorkerEnabled,true)
  assert.equal(lastState.schedulerStarted,true)
  const row=await db.query('SELECT status,source_host FROM import_jobs WHERE id=$1',[id])
  assert.equal(row.rowCount,1)
  assert.equal(row.rows[0].source_host,'photos.app.goo.gl')
  const duplicates=await db.query('SELECT count(*)::int AS total FROM import_jobs WHERE id=$1',[id])
  assert.equal(duplicates.rows[0].total,1)
  console.log('GOOGLE_PHOTOS_REAL_WORKER_E2E '+JSON.stringify({
    sameJobId:true,queuedBefore:true,
    statusAfterRestart:transitioned.status,
    workerEnabled:true,
    noDuplicateJob:true,
    note:'No production access and no product publication',
  }))
  await stopServer(started)
}finally{
  for(const child of children){try{process.kill(-child.pid,'SIGTERM')}catch{}}
  closeSync(fd)
  await db.end()
}
