import { load } from 'cheerio'
import { safeRequest, detectPlatform } from '../server/scanner-collector.mjs'
import { extractFacilZapRuntime, facilZapProducts } from '../server/scanner-platforms.mjs'
const targets = [
  'https://bijouxalexandre.com.br/',
  'https://facilzap.app.br/damafinnalingerie',
  'https://damafinnalingerie.com.br/',
]
const clean=(s)=>String(s||'').replace(/token|secret|password|authorization/gi,'[redacted]').slice(0,280)
for (const target of targets) {
  try {
    const r=await safeRequest(target,{timeout:19000,maxBytes:8*1024*1024})
    const $=load(r.body)
    const scripts=$('script[src]').map((_,e)=>$(e).attr('src')).get()
    const sources=$('img').map((_,e)=>({src:$(e).attr('src'),lazy:$(e).attr('data-src')})).get()
    const fetchSnippets=[...r.body.matchAll(/.{0,110}(?:fetch\(|axios\.|\/api\/|\.json|catalog|produto|graphql).{0,120}/gi)].slice(0,25).map(x=>clean(x[0]))
    console.log('SITE',JSON.stringify({requested:target,finalUrl:r.url,status:r.status,type:r.contentType,length:r.body.length,platform:detectPlatform(r.body,r.url),title:$('title').text(),scripts:scripts.slice(0,35),images:sources.slice(0,8),runtime:extractFacilZapRuntime(r.body),snippets:fetchSnippets}))
    // Inspect only JS files referenced publicly by Alexandre's page.
    if(target.includes('bijouxalexandre')){
      for(const script of scripts.slice(0,12)){
        try{
          const u=new URL(script,r.url)
          if(u.origin!==new URL(r.url).origin || !u.pathname.endsWith('.js'))continue
          const js=await safeRequest(u.toString(),{timeout:15000,maxBytes:4*1024*1024})
          const matches=[...js.body.matchAll(/.{0,110}(?:fetch\(|axios\.|\/api\/|\.json|catalog|produto|graphql|pagination).{0,130}/gi)].slice(0,35).map(x=>clean(x[0]))
          console.log('ALEX_SCRIPT',JSON.stringify({url:u.toString(),status:js.status,bytes:js.body.length,matches}))
        }catch(e){console.log('SCRIPT_ERROR',clean(e.message))}
      }
    }
    const runtime=extractFacilZapRuntime(r.body)
    if(runtime?.urlCarregarProdutosTemplate){
      const endpoint=String(runtime.urlCarregarProdutosTemplate).replace('{PAGE}','1').replace('{CATEGORY}','todas')
      const u=new URL(endpoint,r.url);u.searchParams.set('mobile','0')
      const page=await safeRequest(u.toString(),{method:'POST',accept:'application/json,text/plain,*/*',headers:{'content-type':'application/json'},body:{pagina_especifica:runtime.paginaEspecifica||''},timeout:18000})
      let data={};try{data=JSON.parse(page.body)}catch{}
      const raw=data?.produtos??data?.products??data?.data??[]
      const entries=Array.isArray(raw)?raw:Object.values(raw||{})
      const mapped=facilZapProducts(data,r.url)
      const sample=entries.find(x=>x&&typeof x==='object')||{}
      console.log('FZ_PAGE',JSON.stringify({url:u.toString(),status:page.status,type:page.contentType,count:entries.length,keys:Object.keys(sample),photos:Object.fromEntries(Object.entries(sample).filter(([k])=>/image|imagem|foto|galeria|media|variac/i.test(k)).map(([k,v])=>[k,JSON.stringify(v).slice(0,900)])),mappedPhotos:mapped.products[0]?.images?.slice(0,8),mappedVariants:mapped.products[0]?.variants?.slice(0,3)}))
    }
  } catch(e){console.log('SITE_ERROR',JSON.stringify({target,error:clean(e.message)}))}
}
