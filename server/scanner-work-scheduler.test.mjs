import test from 'node:test'
import assert from 'node:assert/strict'
import { createScannerWorkScheduler } from './scanner-work-scheduler.mjs'

const deferred = () => {
  let resolve, reject
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('one stuck website does not block PDF or normalization processing',async()=>{
  const site=deferred(),pdf=deferred(),normal=deferred()
  const started=[]
  let recoveryChecks=0
  const jobQueue={
    normalization:[{id:'normalize-1'}],
    pdf:[{id:'pdf-1'}],
    site:[{id:'site-1'}],
  }
  const scheduler=createScannerWorkScheduler({
    ensureSchema:async()=>{},
    recover:async()=>{recoveryChecks++;return []},
    findNext:async lane=>jobQueue[lane].shift(),
    processScan:async id=>{
      started.push(id)
      return id==='site-1'?site.promise:pdf.promise
    },
    processNormalization:async id=>{
      started.push(id)
      return normal.promise
    },
  })
  await scheduler.tick()
  await flush()
  assert.deepEqual(started.sort(),['normalize-1','pdf-1','site-1'])
  assert.equal(recoveryChecks,1)
  await scheduler.tick()
  assert.equal(recoveryChecks,2,
    'Scanner lease recovery must still run while a site is hung')
  pdf.resolve()
  normal.resolve()
  await flush()
  jobQueue.pdf.push({id:'pdf-2'})
  await scheduler.tick()
  await flush()
  assert.ok(started.includes('pdf-2'),
    'Later PDFs must not remain behind an unrelated website scan')
  site.resolve()
  await flush()
})

test('one failed scan releases its own lane',async()=>{
  const started=[],errors=[]
  const pending=[{id:'site-bad'},{id:'site-good'}]
  const scheduler=createScannerWorkScheduler({
    ensureSchema:async()=>{},
    recover:async()=>[],
    findNext:async lane=>lane==='site'?pending.shift():null,
    processScan:async id=>{
      started.push(id)
      if(id==='site-bad') throw new Error('Network failed')
    },
    processNormalization:async()=>{},
    log:(message,error)=>errors.push(message+' '+(error?.message||error||'')),
  })
  await scheduler.tick()
  await flush()
  await scheduler.tick()
  await flush()
  assert.deepEqual(started,['site-bad','site-good'])
  assert.ok(errors.some(x=>x.includes('Network failed')))
})
