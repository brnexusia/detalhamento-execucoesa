import http from 'k6/http'
import {check,sleep} from 'k6'
import {Rate,Counter} from 'k6/metrics'
const base=__ENV.BASE_URL
if(base!=='http://127.0.0.1:3000'||__ENV.SHOPVAX_PERF_LOCAL_ONLY!=='1')throw Error('Only localhost disposable lab')
const stores=JSON.parse(open('/tmp/shopvax-k6-fixtures.json')).stores
const size=Number(__ENV.BUYER_VUS||1000)
if(![1000,2000].includes(size))throw Error('Only 1000 or 2000 virtual buyers')
const failed=new Rate('business_failed')
const created=new Counter('orders_created')
const queued=new Counter('imports_enqueued')
const reads=new Counter('buyer_reads')
const merchantReads=new Counter('merchant_reads')
function store(){return stores[(__VU-1)%stores.length]}
function validate(r,status,action){
 const valid=check(r,{'expected status':x=>x.status===status},{action})
 failed.add(!valid,{action})
 return valid
}
export const options={
 discardResponseBodies:true,
 scenarios:{
  buyers:{executor:'constant-vus',vus:size,duration:'20s',exec:'buyer',gracefulStop:'5s'},
  merchants:{executor:'constant-vus',vus:60,duration:'20s',exec:'merchant',gracefulStop:'5s'},
  orders:{executor:'constant-vus',vus:150,duration:'20s',exec:'order',gracefulStop:'5s'},
  imports:{executor:'constant-vus',vus:150,duration:'20s',exec:'importer',gracefulStop:'5s'}
 },
 thresholds:{http_req_failed:['rate<0.05'],business_failed:['rate<0.05'],http_req_duration:['p(95)<3000']}
}
export function buyer(){
 const s=store()
 const r=http.get(base+'/api/public/store/'+encodeURIComponent(s.slug)+'?limit=18',
 {timeout:'15s',tags:{action:'buyer_store'}})
 if(validate(r,200,'buyer_store'))reads.add(1)
 sleep(1+Math.random()*2)
}
export function merchant(){
 const s=store()
 const r=http.get(base+'/api/admin/products?page=1&limit=18',
 {headers:{Cookie:s.cookie},timeout:'15s',tags:{action:'merchant_products'}})
 if(validate(r,200,'merchant_products'))merchantReads.add(1)
 sleep(1+Math.random())
}
export function order(){
 const s=store()
 const r=http.post(base+'/api/public/orders',JSON.stringify({storeSlug:s.slug,items:[{productId:s.productId,quantity:1}]}),
 {headers:{'content-type':'application/json'},timeout:'15s',tags:{action:'orders'}})
 if(validate(r,201,'orders'))created.add(1)
 sleep(0.5+Math.random()*1.5)
}
export function importer(){
 const s=store()
 // Scanner worker disabled; this checks database enqueue, not actual OCR.
 const url='https://example.com/catalog-'+__VU+'-'+__ITER
 const r=http.post(base+'/api/admin/imports',JSON.stringify({url}),
 {headers:{'content-type':'application/json',Cookie:s.cookie},timeout:'15s',tags:{action:'imports'}})
 if(validate(r,201,'imports'))queued.add(1)
 sleep(0.5+Math.random()*1.5)
}
export function handleSummary(data){
 const m=data.metrics||{}
 const report={
  buyerVUs:size,merchantVUs:60,concurrentOrderVUs:150,concurrentImportVUs:150,
  requests:m.http_reqs?.values?.count||0,failedRate:m.http_req_failed?.values?.rate??null,
  p95Ms:m.http_req_duration?.values?.['p(95)']??null,
  orders:m.orders_created?.values?.count||0,importsEnqueued:m.imports_enqueued?.values?.count||0,
  buyerReads:m.buyer_reads?.values?.count||0,merchantReads:m.merchant_reads?.values?.count||0,
  note:'localhost only, ephemeral DB, 2k VUs not 2k browser sessions, imports only enqueued, no OCR processing'
 }
 return {['/tmp/shopvax-k6-'+size+'.json']:JSON.stringify(report,null,2),stdout:JSON.stringify(report)+'\n'}
}
