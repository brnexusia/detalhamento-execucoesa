import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
const api=new URL(process.env.BASE_URL||'')
const db=new URL(process.env.DATABASE_URL||'')
assert.equal(process.env.SHOPVAX_PERF_LOCAL_ONLY,'1')
assert.equal(api.href,'http://127.0.0.1:3000/')
assert.equal(db.hostname,'127.0.0.1')
assert.equal(db.pathname,'/atacado_perf')
const file='server/public-protection-hooks.mjs'
const original=await readFile(file,'utf8')
const anchor='async function checkCatalogRate(req, visitor) {'
assert.equal(original.split(anchor).length,2)
const line='\n  // Ephemeral localhost runner ONLY. Never change production.\n  return { ok:true,retryAfter:0 }\n'
const patched=original.replace(anchor,anchor+line)
assert.notEqual(patched,original)
await writeFile(file,patched)
console.log('LAB_ONLY_RATE_BYPASS '+JSON.stringify({localOnly:true,changed:file,sourceFile:original.length}))
