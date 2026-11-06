// Read-only QA against PUBLIC storefronts. No credentials, writes or checkout.
// Usage: node server/scanner-architecture-audit.mjs sites.json report.json
// Input: [{url, platform?:string}]. Each engine is sampled once by default.
// Pass --all to probe every URL (never count duplicate engines as new ones).
import { readFile, writeFile } from 'node:fs/promises'
import { safeRequest, collectCatalog } from './scanner-collector.mjs'
import { fingerprintStorefront, architectureCoverage } from './scanner-architecture-fingerprint.mjs'

const wait = (ms) => new Promise(resolve => setTimeout(resolve,ms))
const input = process.argv[2]
const output = process.argv[3] || 'scanner-architecture-audit.json'
const all = process.argv.includes('--all')
if (!input) {
  console.error('Uso: node server/scanner-architecture-audit.mjs sites.json resultado.json [--all]')
  process.exitCode=2
} else {
  const source=JSON.parse(await readFile(input,'utf8'))
  if (!Array.isArray(source)) throw new Error('A lista de sites deve ser um array JSON.')
  const entries=source.slice(0,200)
  const seenDomains=new Set()
  const selectedEngines=new Set()
  const results=[]
  for(const entry of entries) {
    const url=typeof entry==='string'?entry:String(entry?.url||'')
    let target
    try { target=new URL(url) } catch { results.push({url,status:'invalid_url'});continue }
    if(target.protocol!=='https:' || !target.hostname || target.port || target.username || target.password) {
      results.push({url,status:'invalid_url'});continue
    }
    if(seenDomains.has(target.hostname)){results.push({url,status:'duplicate_domain'});continue}
    seenDomains.add(target.hostname)
    const row={url,reportedPlatform:entry?.platform||'',status:'unverified',
      productsExtracted:0,withPrice:0,withImage:0}
    let fingerprint
    try {
      const root=await safeRequest(url,{maxBytes:4*1024*1024,timeout:12000})
      row.httpStatus=root.status
      if(!root.ok){row.status='http_error';results.push(row);continue}
      if(!String(root.contentType).includes('html')){row.status='not_html';results.push(row);continue}
      fingerprint=fingerprintStorefront(root.body,root.url)
      Object.assign(row,{engine:fingerprint.engine,frontend:fingerprint.frontend,
        feeds:fingerprint.feeds,architectureKey:fingerprint.architectureKey,
        evidence:fingerprint.evidence,verifiedBy:fingerprint.verifiedBy})
      // A different hostname does not count as a new engine. Keep variants
      // recorded as context, not independent architecture passes.
      const groupKey=fingerprint.engine
      if(!all&&selectedEngines.has(groupKey)){
        row.status='same_engine_not_scanned'
        results.push(row);continue
      }
      selectedEngines.add(groupKey)
      row.status='scanning'
      let count=0,priced=0,imaged=0
      const collected=await collectCatalog(root.url,{
        maxPages:12,maxProducts:40,collectInMemory:false,
        onBatch:async products=>{
          for(const p of products){
            count++
            if(p?.price!=null&&Number.isFinite(Number(p.price))&&Number(p.price)>0)priced++
            if(Array.isArray(p?.images)&&p.images.length)imaged++
          }
        },
        onProgress:async()=>{},
        // strict adapters distinguish real parsing breakage from generic fallback.
        strictPlatformAdapters:true,
      })
      row.productsExtracted=count||Number(collected?.candidateCount||0)
      row.withPrice=priced
      row.withImage=imaged
      row.scannerPlatform=collected?.platform||''
      row.status=row.productsExtracted>0?'extracted':'no_products'
    }catch(error){row.status='scanner_error';row.error=String(error?.message||error).slice(0,300)}
    results.push(row)
    await wait(1000)
  }
  const engines=[...new Set(results.filter(r=>r.engine&&r.engine!=='unknown').map(r=>r.engine))]
  const report={
    generatedAt:new Date().toISOString(),
    methodology:'Read-only ShopVax collector on publicly accessible sites; per-engine uniqueness, not URL count',
    testedLinks:results.filter(r=>['extracted','scanner_error','no_products'].includes(r.status)).length,
    extractedLinks:results.filter(r=>r.status==='extracted').length,
    distinctConfirmedEngines:engines.length,
    uniqueEngineNames:engines.sort(),
    implementationVariants:architectureCoverage(results.filter(r=>r.architectureKey)),
    rows:results,
  }
  await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8')
  console.log(JSON.stringify({output,sites:entries.length,tested:report.testedLinks,
    extracted:report.extractedLinks,distinctEngines:report.distinctConfirmedEngines,engines:report.uniqueEngineNames}))
}