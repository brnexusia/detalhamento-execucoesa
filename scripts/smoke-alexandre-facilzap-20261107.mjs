import { collectCatalog } from '../server/scanner-collector.mjs'
import { fetchImportImage } from '../server/import-media-localizer.mjs'
const targets=[
 {name:'alexandre',url:'https://bijouxalexandre.com.br/',maxProducts:100000},
 {name:'facilzap',url:'https://facilzap.app.br/damafinnalingerie',maxProducts:48},
]
for(const target of targets){
 const start=Date.now()
 try{
  const data=await collectCatalog(target.url,{maxProducts:target.maxProducts,strictPlatformAdapters:true})
  const candidates=data.candidates||[]
  const firstImages=[...new Set(candidates.flatMap(x=>x.images||[]))].slice(0,5)
  const imageResults=[]
  for (const url of firstImages){
    try{const result=await fetchImportImage(url,{referer:target.url})
      imageResults.push({url,status:'ok',bytes:result.buffer.length,mime:result.mimeType})
    }catch(e){imageResults.push({url,status:'error',error:String(e.message)})}
  }
  console.log('LIVE_IMPORT',JSON.stringify({
   name:target.name,platform:data.platform,found:data.candidateCount,
   complete:data.complete,expected:data.expectedProducts,pages:data.pagesScanned,
   withImage:candidates.filter(p=>p.images?.length).length,
   missingImages:candidates.filter(p=>!p.images?.length).slice(0,8).map(p=>({id:p.external_id,title:p.title,source:p.source_url})),
   withPrice:candidates.filter(p=>p.price!=null).length,
   withVariantImages:candidates.filter(p=>p.variants?.some(v=>v.images?.length)).length,
   variantCount:candidates.reduce((n,p)=>n+(p.variants?.length||0),0),
   photos:candidates.reduce((n,p)=>n+(p.images?.length||0),0),
   photosTested:imageResults,seconds:Math.round((Date.now()-start)/1000),
   warnings:data.warnings||[],
  }))
 }catch(e){console.log('LIVE_IMPORT_ERROR',JSON.stringify({name:target.name,error:String(e.stack||e.message).slice(0,1200)}));process.exitCode=1}
}
