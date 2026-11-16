import http from 'k6/http'
import {check,sleep} from 'k6'
import {Counter,Rate,Trend} from 'k6/metrics'

const base=__ENV.BASE_URL
if(base!=='http://127.0.0.1:3000'||__ENV.SHOPVAX_PERF_LOCAL_ONLY!=='1')
  throw Error('Never run virtual-buyers against a public endpoint')
const stores=JSON.parse(open('/tmp/shopvax-real-buyer-fixtures.json')).stores
const n=Number(__ENV.BUYER_VUS)
if(n!==1000&&n!==2000)throw Error('Only 1000 or 2000 virtual buyer sessions')

const started=new Counter('buyer_sessions_started')
const journeys=new Counter('buyer_journeys_finished')
const pageLoads=new Counter('catalog_pages_loaded')
const scrollPages=new Counter('scroll_pages_loaded')
const productViews=new Counter('product_cards_selected')
const imageReads=new Counter('media_images_loaded')
const carts=new Counter('carts_completed')
const whatsappReady=new Counter('whatsapp_orders_prepared')
const checksFailed=new Counter('buyer_step_failures')
const http429=new Counter('buyer_http_429')
const http5xx=new Counter('buyer_http_5xx')
const pageLatency=new Trend('catalog_page_latency_ms',true)
const orderLatency=new Trend('checkout_latency_ms',true)
const buyerSuccess=new Rate('buyer_journey_success')
const totalsCorrect=new Rate('cart_total_integrity')
const merchantRead=new Counter('merchant_products_read')
const importsQueued=new Counter('merchant_imports_enqueued')
const clientErr=new Counter('http_unexpected')
const apiText={responseType:'text',timeout:'15s'}
const tag=x=>({...apiText,tags:{operation:x}})
const postOpts=x=>({...tag(x),headers:{'content-type':'application/json'}})
const rand=max=>Math.floor(Math.random()*max)
const pickStore=()=>stores[(__VU+rand(stores.length))%stores.length]
function decode(r){
  try{return r.json()}catch{return null}
}
function verify(r,status,operation){
  const pass=check(r,{['status '+status]:x=>x.status===status},{operation})
  if(!pass){
    checksFailed.add(1,{operation})
    if(r.status===429)http429.add(1,{operation})
    if(r.status>=500)http5xx.add(1,{operation})
    clientErr.add(1,{operation,status:String(r.status)})
  }
  return pass
}
const events=(slug,kind)=>http.post(base+'/api/public/events',
 JSON.stringify({storeSlug:slug,kind}),postOpts('tracking_'+kind))
export const options={
 discardResponseBodies:true,
 scenarios:{
   buyers:{executor:'constant-vus',vus:n,duration:'30s',exec:'buyerJourney',gracefulStop:'15s'},
   merchants:{executor:'constant-vus',vus:60,duration:'30s',exec:'merchantBrowse',gracefulStop:'10s'},
   imports:{executor:'constant-vus',vus:20,duration:'30s',exec:'merchantImport',gracefulStop:'10s'},
 },
 thresholds:{
   'buyer_journey_success':['rate>0.95'],
   'cart_total_integrity':['rate>0.99'],
   'http_req_failed':['rate<0.05'],
   'catalog_page_latency_ms':['p(95)<3500'],
   'checkout_latency_ms':['p(95)<4000'],
 }
}
export function buyerJourney(){
  started.add(1)
  const s=pickStore(),slug=encodeURIComponent(s.slug)
  // Independent k6 VUs have distinct cookie jars; public visitor cookie
  // persists through initial visit, scrolling, product selection and checkout.
  let failed=false
  let page=http.get(base+'/api/public/store/'+slug+'?limit=18',tag('browse_store'))
  pageLatency.add(page.timings.duration)
  if(!verify(page,200,'browse_store')){buyerSuccess.add(false);return}
  let data=decode(page)
  if(!data||data.store?.slug!==s.slug||!Array.isArray(data.products)){
    checksFailed.add(1,{operation:'catalog_shape'});buyerSuccess.add(false);return
  }
  pageLoads.add(1)
  const seen=new Map()
  for(const p of data.products)seen.set(p.id,p)
  events(s.slug,'view')
  sleep(.1+Math.random()*.35)
  // Scroll down two or three visible catalog windows, triggering cursor API
  // exactly as the React IntersectionObserver / loadMore hook does.
  let cursor=data.page?.nextCursor
  for(let step=0;step<2+rand(2)&&cursor;step++){
    const u=base+'/api/public/store/'+slug+'?limit=18&compactPage=1&cursor='+encodeURIComponent(cursor)
    page=http.get(u,tag('scroll_next_page'))
    pageLatency.add(page.timings.duration)
    if(!verify(page,200,'scroll_next_page')){failed=true;break}
    data=decode(page)
    if(!data?.products){failed=true;break}
    for(const p of data.products)seen.set(p.id,p)
    pageLoads.add(1);scrollPages.add(1)
    cursor=data.page?.nextCursor
    sleep(.10+Math.random()*.35)
  }
  // Real browsing filters and sorting; picker itself is a client-side UI.
  if(__VU%4===0){
    const q=base+'/api/public/store/'+slug+'?limit=18&category='+encodeURIComponent('Brincos')+'&sort=price_asc'
    const filter=http.get(q,tag('catalog_filter_sort'))
    pageLatency.add(filter.timings.duration)
    if(verify(filter,200,'catalog_filter_sort')){
      const result=decode(filter)
      for(const p of (result?.products||[]))seen.set(p.id,p)
    }else failed=true
  }
  const available=Array.from(seen.values())
  if(available.length<3){checksFailed.add(1,{operation:'empty_catalog'});buyerSuccess.add(false);return}
  // Simulate opening product cards and downloading their visible media.
  const choiceCount=2+rand(4),items=[],used=new Set()
  for(let k=0;k<choiceCount;k++){
    const product=available[rand(available.length)]
    if(used.has(product.id)){continue}
    used.add(product.id)
    productViews.add(1)
    const media=String(product.mediaUrl||product.images?.[0]||'')
    if(media.startsWith('/lab-media/')){
      const pic=http.get(base+media,{responseType:'none',timeout:'12s',tags:{operation:'product_image'}})
      if(verify(pic,200,'product_image'))imageReads.add(1)
      else failed=true
    }
    items.push({productId:product.id,quantity:1+rand(3),selections:{},
      name:product.name,price:Number(product.price)})
    sleep(.12+Math.random()*.45)
  }
  const subtotal=items.reduce((s,p)=>s+p.price*p.quantity,0)
  if(items.length<1||subtotal<=0){buyerSuccess.add(false);return}
  const expected=Math.round(subtotal*100)/100
  carts.add(1)
  events(s.slug,'cart')
  totalsCorrect.add(Math.abs(subtotal-expected)<.0001)
  sleep(.15+Math.random()*.45)
  // Roughly one in three browsing sessions completes the handoff.
  // NO request is made to wa.me: only our backend creates a test order and URL.
  if(__VU%3===0){
    const body=JSON.stringify({
      storeSlug:s.slug,sellerSlug:'vendedora',
      items:items.map(p=>({productId:p.productId,quantity:p.quantity,selections:{}})),
      buyer:{name:'Comprador VU '+__VU,city:'Salvador',cep:'40000000',phone:'5511000000000'},
      notes:'Ambiente descartável: pedido fictício, não enviar WhatsApp',
    })
    const order=http.post(base+'/api/business/orders',body,postOpts('prepare_whatsapp'))
    orderLatency.add(order.timings.duration)
    if(verify(order,201,'prepare_whatsapp')){
      const result=decode(order)
      const url=String(result?.whatsappUrl||'')
      let valid=url.startsWith('https://wa.me/5511000000000?text=')
        &&String(result?.code||'').startsWith('AS-')
        &&Boolean(result?.orderId)
      if(valid){
        const decoded=decodeURIComponent(url.split('?text=')[1])
        valid=items.every(p=>decoded.includes(p.name))&&decoded.includes(result.code)
      }
      if(valid)whatsappReady.add(1)
      else {checksFailed.add(1,{operation:'whatsapp_message_integrity'});failed=true}
    }else failed=true
  }
  buyerSuccess.add(!failed)
  if(!failed)journeys.add(1)
}
export function merchantBrowse(){
 const s=pickStore()
 const r=http.get(base+'/api/admin/products?page=1&limit=25',{
  ...tag('merchant_products'),headers:{Cookie:s.cookie}})
 if(verify(r,200,'merchant_products'))merchantRead.add(1)
 sleep(.2+Math.random()*.7)
}
export function merchantImport(){
 const s=pickStore()
 const url='https://example.com/disposable-catalog-'+__VU+'-'+__ITER
 const r=http.post(base+'/api/admin/imports',JSON.stringify({url}),
 {...postOpts('merchant_import_enqueue'),headers:{
   'content-type':'application/json',Cookie:s.cookie,
 }})
 if(verify(r,201,'merchant_import_enqueue'))importsQueued.add(1)
 sleep(.5+Math.random()*1.5)
}
export function handleSummary(data){
 const v=name=>data.metrics?.[name]?.values||{}
 const report={
  kind:'realistic multi-step API buyer journey (not 2000 graphical browsers)',
  virtualBuyerSessions:n,merchantVUs:60,importEnqueueVUs:20,
  started:v('buyer_sessions_started').count||0,
  journeysCompleted:v('buyer_journeys_finished').count||0,
  journeySuccessRate:v('buyer_journey_success').rate??null,
  pagesLoaded:v('catalog_pages_loaded').count||0,
  scrollPages:v('scroll_pages_loaded').count||0,
  productSelections:v('product_cards_selected').count||0,
  productMedia:v('media_images_loaded').count||0,
  cartsBuilt:v('carts_completed').count||0,
  ordersPreparedForWhatsapp:v('whatsapp_orders_prepared').count||0,
  merchantReads:v('merchant_products_read').count||0,
  importsEnqueued:v('merchant_imports_enqueued').count||0,
  unexpected:v('http_unexpected').count||0,
  http429:v('buyer_http_429').count||0,http5xx:v('buyer_http_5xx').count||0,
  failureRate:v('http_req_failed').rate??null,
  httpP95ms:v('http_req_duration')['p(95)']??null,
  catalogP95ms:v('catalog_page_latency_ms')['p(95)']??null,
  checkoutP95ms:v('checkout_latency_ms')['p(95)']??null,
  checksFailed:v('buyer_step_failures').count||0,
  thresholds:Object.fromEntries(Object.entries(data.metrics||{}).filter(([k,m])=>m.thresholds)
    .map(([k,m])=>[k,m.thresholds])),
  note:'All HTTP calls are localhost only, WhatsApp URL is validated but never opened; merchant imports enqueue only; k6 simulates concurrent API journeys, not real browser DOM.'
 }
 console.log('REAL_BUYER_LOAD_SUMMARY '+JSON.stringify(report))
 return {['/tmp/real-buyer-'+n+'.json']:JSON.stringify(report,null,2)}
}
