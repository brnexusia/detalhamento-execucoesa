import { load } from 'cheerio'
import { safeRequest,detectPlatform } from '../server/scanner-collector.mjs'
import { extractFacilZapRuntime,parseVestiContext } from '../server/scanner-platforms.mjs'
const targets=[
 {label:'facilzap1',url:'https://facilzap.app.br/damafinnalingerie'},
 {label:'facilzap2',url:'https://facilzap.com.br/centralbrasatacado'},
 {label:'gopage',url:'https://meuestoque.catalogo.com.br/'},
 {label:'gopage_category',url:'https://meuestoque.catalogo.com.br/categoria/celulares-mRwey'},
 {label:'vesti',url:'https://v.vesti.mobi/l2m/catalogo/3d65968050c8488'},
 {label:'vesti_without_id',url:'https://v.vesti.mobi/leslymodas/catalogo'},
]
for (const entry of targets){
 try {
  const r=await safeRequest(entry.url,{timeout:18000})
  const $=load(r.body)
  const links=$('a[href]').map((_,a)=>$(a).attr('href')).get()
  const tags=[...r.body.matchAll(/.{0,70}(?:catalogo|produtos|pageSize|pagination|totalPages|page_count|carregar_produtos|FZCatalogoRuntime|nextPage|apiUrl|catalogId|gopage|vesti).{0,130}/gi)].slice(0,30).map(x=>x[0].replace(/\s+/g,' ').slice(0,210))
  const scripts=$('script[src]').map((_,a)=>$(a).attr('src')).get().slice(0,25)
  console.info('PLATFORM_DIAG',JSON.stringify({
    label:entry.label,url:r.url,status:r.status,length:r.body.length,platform:detectPlatform(r.body,r.url),
    contentType:r.contentType,
    runtime:extractFacilZapRuntime(r.body),vesti:parseVestiContext(r.url,r.body),
    paginationLinks:links.filter(s=>/page|pagina|categoria|produto|catalog|colecao|carregar|p=\d/i.test(s)).slice(0,32),
    scripts,patterns:tags,
  }))
 } catch(e){console.info('PLATFORM_DIAG',JSON.stringify({label:entry.label,error:String(e?.message||e).slice(0,300)}))}
}
