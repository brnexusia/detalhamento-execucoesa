import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const db=new URL(process.env.DATABASE_URL||'postgres://bad@invalid/nothing')
const api=new URL(process.env.BASE_URL||'http://bad')
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.ok(['127.0.0.1','localhost'].includes(db.hostname))
assert.ok(['127.0.0.1','localhost'].includes(api.hostname))
assert.ok(/_perf$/.test(db.pathname))
// Modify the CHECKED-OUT, disposable runner copy only.
// This is required because k6 VUs all share the same CI public source IP.
const file='server/public-protection-hooks.mjs'
const original=await readFile(file,'utf8')
const anchor="if (process.env.SHOPVAX_PUBLIC_CATALOG_RATE_LIMIT_DISABLED === '1') return { ok: true, retryAfter: 0 }"
assert.equal(original.split(anchor).length,2,'catalog protection source changed: refuse benchmark patch')
const substitute="if (process.env.SHOPVAX_PERF_LOCAL_ONLY === '1' || process.env.SHOPVAX_PUBLIC_CATALOG_RATE_LIMIT_DISABLED === '1') return { ok: true, retryAfter: 0 }"
await writeFile(file,original.replace(anchor,substitute))
console.log('K6_LOCAL_ONLY_CATALOG_RATE_BYPASS_APPLIED')
