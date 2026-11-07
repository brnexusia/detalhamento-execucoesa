import { mkdir,writeFile } from 'node:fs/promises'
import { collectCatalog } from '../server/scanner-collector.mjs'

const sites=[
 {platform:'gopage',url:'https://meuestoque.catalogo.com.br/',maxProducts:500,maxPages:120},
 {platform:'vesti',url:'https://v.vesti.mobi/l2m/catalogo/3d65968050c8488',maxProducts:200,maxPages:40},
 {platform:'facilzap',url:'https://facilzap.app.br/damafinnalingerie',maxProducts:200,maxPages:70},
]
await mkdir('artifacts/full-site-catalogs',{recursive:true})
const results=[]
for(const site of sites) {
 const start=Date.now()
 let withImage=0,withPrice=0,withVariation=0,withSku=0,withCategory=0,withDescription=0,photos=0,variants=0
 const uniqueIds=new Set(),invalidIds=[],withoutImages=[],withoutDescription=[],withoutPrice=[]
 let lastPage=0,done=false,candidateCount=0
 try{
  const got=await collectCatalog(site.url,{
   maxProducts:site.maxProducts,maxPages:site.maxPages,collectInMemory:false,
   strictPlatformAdapters:true,
   onProgress:async(x)=>{lastPage=Math.max(lastPage,x.pagesScanned||0)},
   onBatch:async(items)=>{
    for(const x of items) {
     const id=x.external_id||x.source_url
     if(!id || uniqueIds.has(id))invalidIds.push(id)
     else uniqueIds.add(id)
     if(x.images?.length){withImage++;photos+=x.images.length}
     else if(withoutImages.length<30)withoutImages.push({id:x.external_id,title:x.title,url:x.source_url})
     if(Number(x.price)>0)withPrice++
     else if(withoutPrice.length<15)withoutPrice.push({id:x.external_id,title:x.title})
     if(x.variants?.length){withVariation++;variants+=x.variants.length}
     if(x.sku)withSku++
     if(x.category)withCategory++
     if(x.description)withDescription++
     else if(withoutDescription.length<20)withoutDescription.push({id:x.external_id,title:x.title})
    }
   },
  })
  done=true
  candidateCount=got.candidateCount
  const expected=got.expectedProducts
  const capped=Number.isFinite(site.maxProducts)&&got.candidateCount>=site.maxProducts
  const report={...site,status:'ok',platformDetected:got.platform,
   found:got.candidateCount,expectedPublic:expected??null,capped,
   complete:got.complete??(expected!=null?got.candidateCount>=expected&&!capped:!capped),
   withPrice,withImage,photos,withSku,withCategory,withDescription,withVariation,variants,
   duplicateIds:invalidIds.length,pagesScanned:got.pagesScanned,
   durationSeconds:Math.round((Date.now()-start)/100)/10,
   warnings:got.warnings||[],withoutImages,withoutDescription,withoutPrice,
  }
  results.push(report)
  console.info('FULL_SITE_RESULT',JSON.stringify(report))
 }catch(error){
  const report={...site,status:'error',found:uniqueIds.size,withPrice,withImage,
   withVariation,photos,variants,withSku,withCategory,withDescription,
   pagesScanned:lastPage,durationSeconds:Math.round((Date.now()-start)/100)/10,
   error:String(error?.message||error).slice(0,650)}
  results.push(report);console.warn('FULL_SITE_RESULT',JSON.stringify(report))
 }
}
await writeFile('artifacts/full-site-catalogs/summary.json',JSON.stringify({
 testedAt:new Date().toISOString(),note:'Read-only public catalogs; no products or shop data published',results,
},null,2))
if(results.some(x=>x.status==='error'))process.exitCode=1
