import { alexandreProduct } from '../server/scanner-alexandre-bijoux.mjs'
import { normalizeCandidate } from '../server/scanner-normalizer.mjs'
import { importParentKey } from '../server/scanner-import-grouping.mjs'
const origin='https://bijouxalexandre.com.br'
const get=async(path)=>{
 const controller=new AbortController()
 const timeout=setTimeout(()=>controller.abort(),20000)
 try{
  const r=await fetch(origin+path,{signal:controller.signal,headers:{accept:'application/json'}})
  if(!r.ok)throw Error(path+' HTTP '+r.status)
  return r.json()
 }finally{clearTimeout(timeout)}
}
const categories=await get('/api/categorias')
const products=[]
for(const category of categories){
 const body=await get('/api/categorias/'+encodeURIComponent(category.id)+'/produtos')
 for(const raw of body.produtos||[])products.push(alexandreProduct(raw,category,origin))
}
const normalized=products.map(p=>normalizeCandidate(p).normalized)
const groups=new Map()
for(let i=0;i<normalized.length;i++){
 const data=normalized[i],key=importParentKey(data)
 if(!groups.has(key))groups.set(key,{count:0,name:data.name,price:data.price,ids:new Set()})
 const item=groups.get(key);item.count++;item.ids.add(products[i].external_id)
}
const duplicates=[...groups.values()].filter(g=>g.count>1).sort((a,b)=>b.count-a.count)
console.log('ALEX_GROUPING_DIAGNOSTIC',JSON.stringify({
 collected:products.length,uniqueExternalIds:new Set(products.map(x=>x.external_id)).size,
 publishingGroupsWithCurrentAlgorithm:groups.size,
 collapseCount:products.length-groups.size,
 repeatedBuckets:duplicates.length,
 largest:duplicates.slice(0,12).map(g=>({name:g.name,price:g.price,merged:g.count})),
}))
if(products.length<500)throw Error('live API returned unexpectedly few products')
