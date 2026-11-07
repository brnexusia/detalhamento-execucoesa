import { writeFile, mkdir } from 'node:fs/promises'
import { collectCatalog } from '../server/scanner-collector.mjs'

const samples = [
  { name: 'Saint Germain', platform: 'Nuvemshop', url: 'https://saintgermainbrand.com.br/' },
  { name: 'Jambô Editora', platform: 'WooCommerce', url: 'https://jamboeditora.com.br/' },
  { name: 'Lótus Velas', platform: 'Loja própria', url: 'https://lotusvelas.com.br/' },
  { name: 'Meu Estoque', platform: 'GoPage', url: 'https://meuestoque.catalogo.com.br/' },
  { name: 'Damafinna', platform: 'FácilZap', url: 'https://facilzap.app.br/damafinnalingerie' },
]

async function inspect(site) {
  const start = performance.now()
  try {
    const extracted = await collectCatalog(site.url, {
      maxProducts: 5,
      maxPages: 18,
      collectInMemory: true,
    })
    const rows = extracted.candidates ?? []
    const seen = new Set()
    const products = rows.filter(x => {
      const key = String(x.external_id||x.source_url||x.title).trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0,5)
    return {
      ...site,
      status: products.length ? 'parsed' : 'empty',
      detected_platform: extracted.platform,
      pages_scanned: extracted.pagesScanned,
      count: products.length,
      prices: products.filter(x=>Number.isFinite(Number(x.price)) && Number(x.price)>0).length,
      names: products.filter(x=>String(x.title||'').trim()).length,
      photos: products.filter(x=>(x.images||[]).length).length,
      descriptions: products.filter(x=>String(x.description||'').trim()).length,
      duration_ms: Math.round(performance.now()-start),
      products: products.map(x=>({
        name: String(x.title||'').slice(0,160),
        price: x.price,
        price_text: x.price_text,
        photo_count: (x.images||[]).length,
        description_chars: String(x.description||'').length,
        source: x.source,
        source_url: x.source_url,
      })),
    }
  } catch(error) {
    return {...site,status:'error',error:String(error?.message||error).slice(0,550), duration_ms:Math.round(performance.now()-start)}
  }
}

await mkdir('artifacts/paddle-sites',{recursive:true})
const results=[]
for(let i=0;i<samples.length;i+=2) {
  const batch=await Promise.all(samples.slice(i,i+2).map(inspect))
  results.push(...batch)
  for(const value of batch) console.info('SITE_RESULT',JSON.stringify(value))
}
const summary={
  tested_at:new Date().toISOString(),
  importer:'collectCatalog/HTML - PaddleOCR is NOT invoked on site HTML',
  sites:results,
  parsed:results.filter(x=>x.status==='parsed').length,
  error:results.filter(x=>x.status==='error').length,
}
await writeFile('artifacts/paddle-sites/results.json',JSON.stringify(summary,null,2))
console.info('SITES_SUMMARY',JSON.stringify({parsed:summary.parsed,error:summary.error,sites:summary.sites.map(x=>({name:x.name,status:x.status,count:x.count,prices:x.prices,photos:x.photos,error:x.error}))}))
