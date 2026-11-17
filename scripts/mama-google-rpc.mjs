import {chromium} from 'playwright'
const url='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const b=await chromium.launch({headless:true,args:['--no-sandbox']})
const p=await b.newPage({viewport:{width:1200,height:850}})
const seen=new Set()
p.on('request',req=>{
 if(!/batchexecute|PhotosUi\/data|rpcids|_\/data\//i.test(req.url()))return
 const key=req.method()+' '+req.url().split('?')[0]
 const number=seen.size+1
 if(number>18)return
 seen.add(key+'#'+number)
 const body=req.postData()||''
 console.log('MAMA_RPC_REQUEST '+JSON.stringify({method:req.method(),url:req.url().slice(0,500),bodyBytes:body.length,bodyHead:body.slice(0,1200),decodedReq:new URLSearchParams(body).get('f.req')?.slice(0,2200),headers:Object.fromEntries(Object.entries(req.headers()).filter(([k])=>['content-type','x-same-domain','x-goog-authuser'].includes(k)))}))
})
p.on('response',async res=>{
 const req=res.request()
 if(!/batchexecute|PhotosUi\/data|rpcids|_\/data\//i.test(req.url()))return
 try{
  const body=await res.text()
  const imgs=[...body.matchAll(/https?:\\\/\\\/lh3[^\s"']+/g)].slice(0,3).map(m=>m[0].slice(0,150))
  console.log('MAMA_RPC_RESPONSE '+JSON.stringify({url:req.url().slice(0,280),status:res.status(),bytes:body.length,head:body.slice(0,220),tail:body.slice(-650),images:imgs}))
 }catch(e){console.log('MAMA_RPC_RESPONSE_ERROR '+String(e))}
})
try{
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:25000})
 for(let i=0;i<22;i++){
  await p.evaluate(()=>{
   const scrollables=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+500&&e.clientHeight>300)
   const x=scrollables.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]
   if(x)x.scrollTop+=x.clientHeight*4
   else scrollBy(0,innerHeight*4)
  })
  await p.waitForTimeout(480)
 }
}finally{await p.close();await b.close()}
