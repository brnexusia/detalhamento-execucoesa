import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls} from '../server/scanner-photo-albums.mjs'
const links=[
 ['Catálogo Verão', 'https://photos.app.goo.gl/7rFBydymNf2Y5Lfi8'],
 ['Lenços de Verão', 'https://photos.app.goo.gl/uZJuTkVXgEcqDNye7'],
 ['Broches e Chaveiros', 'https://photos.app.goo.gl/xE7JWntJJRo7x1C76'],
 ['Brincos', 'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
 ['Colares - Aros', 'https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9'],
 ['Colares e Maxi Colares', 'https://photos.app.goo.gl/vvusGG4cUbEfzvev7'],
 ['Colares Verniz', 'https://photos.app.goo.gl/4z14SLH91bxMENMX9'],
 ['Pulseiras e Braceletes', 'https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7'],
 ['Chokers e Colares Delicados', 'https://photos.app.goo.gl/4qNDWNyoEig83Dhn9'],
 ['Anéis', 'https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A'],
 ['Cintos', 'https://photos.app.goo.gl/RkuGaNQzA2CFNDCh6'],
 ['Acessórios Cabelo Infantil', 'https://photos.app.goo.gl/WFShKcZthyxqxshMA'],
 ['Catálogo Country', 'https://photos.app.goo.gl/iDwgxFiirce8UfsZ6'],
 ['Acessórios Cabelo Adulto', 'https://photos.app.goo.gl/uwUFrGa1iDKE7iDJ7'],
 ['Acessórios Masculinos', 'https://photos.app.goo.gl/nCj8X8TJ49puAto87'],
 ['Bolsas e Necessaires', 'https://photos.app.goo.gl/dMGADSscxXCJ3VXLA'],
 ['Copos e Porta-joias', 'https://photos.app.goo.gl/4ymqbWGkUmkzpaAa9'],
 ['Brasil Core', 'https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7'],
 ['Catálogo Inverno', 'https://photos.app.goo.gl/GmkVR55GHRgRmHP88'],
 ['Catálogo Inverno Infantil', 'https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9'],
 ['Festa Junina', 'https://photos.app.goo.gl/nHmUk4GjrziN5npD9'],
]


const part=Number(process.env.MAMA_DYNAMIC_PART||0)
if(!Number.isInteger(part)||part<0||part>2)throw Error('invalid part')
const work=links.slice(part*7,part*7+7)
const target='/tmp/mama-dynamic-full'
await mkdir(target,{recursive:true})
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
function key(u){
 try{
  const x=new URL(u)
  if(!/^lh[3-6]\.googleusercontent\.com$/.test(x.hostname)||!/^\/pw\/[A-Za-z0-9_-]{50,}/.test(x.pathname))return ''
  return x.hostname+x.pathname.replace(/=[^/=]+$/,'')
 }catch{return ''}
}
try{
 for(let j=0;j<work.length;j++){
  const index=part*7+j+1
  const [name,url]=work[j]
  const item={index,name,url,expectedStatic:0,dynamic:0,newBeyondStatic:0,finalAtBottom:false,steps:0,errors:[]}
  const requests=new Map()
  let page
  try{
   const response=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
   if(!response.ok)throw Error('cannot fetch public album')
   const staticUrls=googlePhotosImageUrls(response.body,10000)
   const initial=new Set(staticUrls.map(key).filter(Boolean))
   item.expectedStatic=initial.size
   page=await browser.newPage({viewport:{width:1200,height:850}})
   page.on('request',req=>{
    const k=key(req.url())
    if(k&&!requests.has(k))requests.set(k,req.url())
   })
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000})
   let still=0,previous=-1,stableScroll=0,lastTop=-1
   for(let i=0;i<100;i++){
    const state=await page.evaluate(()=>{
     const x=[...document.querySelectorAll('*')]
      .filter(el=>el.scrollHeight>el.clientHeight+500&&el.clientHeight>300)
      .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]
     if(x){
      x.scrollTop+=x.clientHeight*3
      return {top:x.scrollTop,bottom:x.scrollTop+x.clientHeight>=x.scrollHeight-2,scrollHeight:x.scrollHeight}
     }
     scrollBy(0,innerHeight*3)
     return {top:scrollY,bottom:scrollY+innerHeight>=document.body.scrollHeight-2,scrollHeight:document.body.scrollHeight}
    })
    await page.waitForTimeout(450)
    if(requests.size===previous)still++
    else still=0
    if(state.top===lastTop)stableScroll++
    else stableScroll=0
    previous=requests.size;lastTop=state.top
    item.steps=i+1
    if(state.bottom&&still>=7&&stableScroll>=7){
     item.finalAtBottom=true
     break
    }
   }
   const newKeys=[...requests.keys()].filter(x=>!initial.has(x))
   item.dynamic=requests.size
   item.newBeyondStatic=newKeys.length
   item.overlap=requests.size-newKeys.length
   const all=staticUrls.concat([...requests].filter(([k])=>!initial.has(k)).map(([,v])=>v))
   item.candidateUrls=all.length
   await writeFile(target+'/album-'+index+'.json',JSON.stringify({item,urls:all}))
  }catch(e){item.errors.push(String(e).slice(0,400))}
  finally{await page?.close().catch(()=>{})}
  console.log('MAMA_COMPLETE_DYNAMIC '+JSON.stringify(item))
 }
}finally{await browser.close()}
