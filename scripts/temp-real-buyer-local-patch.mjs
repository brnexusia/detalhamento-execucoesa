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
const targeted="  const rate = await checkCatalogRate(req, visitor)"
assert.equal(original.split(targeted).length,2)
const patched=original.replace(anchor,anchor+line).replace(targeted,
  "  res.setHeader('X-Lab-Rate-Bypass','1')\n  const rate = { ok:true,retryAfter:0 }")

assert.notEqual(patched,original)
await writeFile(file,patched)
const catalogFile='server/catalog-features-hooks.mjs'
const catalogOriginal=await readFile(catalogFile,'utf8')
const catalogTarget="  const rate = checkCatalogRate(req, visitor)"
assert.equal(catalogOriginal.split(catalogTarget).length,2,'catalog-features protectedStore signature changed; refuse bypass')
const catalogPatched=catalogOriginal.replace(catalogTarget,
  "  res.setHeader('X-Lab-Rate-Bypass','1')\n  const rate = { ok:true,retryAfter:0 }")
await writeFile(catalogFile,catalogPatched)
console.log('LAB_ONLY_RATE_BYPASS '+JSON.stringify({
  localOnly:true,files:[file,catalogFile],sourceBytes:[original.length,catalogOriginal.length]
}))
