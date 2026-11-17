import { chromium } from 'playwright'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls} from '../server/scanner-photo-albums.mjs'
const albums=[
 ['Brincos','https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
 ['Chokers','https://photos.app.goo.gl/4qNDWNyoEig83Dhn9']
]
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
try{
 for(const [name,url] of albums){
  const response=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
  const normalize=value=>{try{const u=new URL(value);return u.hostname+u.pathname.replace(/=(?:[whs]\d+[\w-]*)$/,'')}catch{return ''}}
  const originalKeys=new Set(googlePhotosImageUrls(response.body,10000).map(normalize))
  const page=await browser.newPage({viewport:{width:1200,height:850}})
  const visited=new Set()
  const images=new Set()
  const requests=new Set()
  page.on('request',request=>{
    const u=request.url()
    if(/^https:\/\/lh[3-6]\.googleusercontent\.com\/pw\//.test(u))requests.add(normalize(u))
  })
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})
    for(let i=0;i<50;i++){
      const state=await page.evaluate(()=>{
        const pics=[...document.querySelectorAll('img')].map(e=>e.currentSrc||e.src)
         .filter(x=>x.includes('googleusercontent.com')).map(x=>x.replace(/=[^/=]+$/,''))
        const container=[...document.querySelectorAll('*')].filter(el=>
          el.scrollHeight>el.clientHeight+500 && el.clientHeight>300)
          .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]
        if(container){container.scrollTop+=container.clientHeight*3}
        else window.scrollBy(0,window.innerHeight*3)
        return {pictures:pics,scrollTop:container?.scrollTop??scrollY,scrollHeight:container?.scrollHeight??document.body.scrollHeight}
      })
      state.pictures.forEach(x=>images.add(x))
      await page.waitForTimeout(450)
      console.log('MAMA_DYNAMIC_INVENTORY '+JSON.stringify({name,step:i+1,domUnique:images.size,networkUnique:requests.size,scrollTop:state.scrollTop,scrollHeight:state.scrollHeight}))
    }
  }catch(e){console.log('MAMA_DYNAMIC_ERROR '+JSON.stringify({name,error:String(e)}))}
  console.log('MAMA_DYNAMIC_FINAL '+JSON.stringify({name,domUnique:images.size,networkUnique:requests.size,urls:[...images].slice(0,3)}))
  await page.close()
 }
}finally{await browser.close()}
