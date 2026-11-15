import sharp from 'sharp'
import { safeRequest } from '../server/scanner-collector.mjs'
import { googlePhotosImageUrls } from '../server/scanner-photo-albums.mjs'

const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const hashes=[0x446075594c664c4cn,0x446074d8cc46cecen,0x46607450884446c6n]
function distance(a,b) {
 let x=a^b,n=0
 while(x){n++;x&=x-1n}
 return n
}
async function hash(bytes,position='centre') {
 const {data,info}=await sharp(bytes).resize(9,8,{fit:'cover',position}).greyscale().raw().toBuffer({resolveWithObject:true})
 const channels=info.channels; let result=0n
 for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
   if(data[(y*9+x)*channels]>data[(y*9+x+1)*channels])result|=1n<<BigInt(y*8+x)
 }
 return result
}
const response=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024})
const urls=googlePhotosImageUrls(response.body,350)
const matches=[]
let cursor=0,completed=0,errors=0
async function worker(){
 while(cursor<urls.length){
  const i=cursor++,url=urls[i]
  try{
   const u=new URL(url)
   u.pathname=u.pathname.replace(/=[^/=]+$/,'=w320-h320')
   const image=await safeRequest(u.toString(),{
      responseType:'buffer',accept:'image/*',maxBytes:1200000,timeout:14000,
   })
   if(!image.ok||!Buffer.isBuffer(image.buffer))throw Error('image missing')
   const digest=await hash(image.buffer)
   const differences=hashes.map(h=>distance(digest,h))
   matches.push({index:i+1,distance:Math.min(...differences),hash:digest.toString(16),url})
  }catch(e){errors++}
  completed++
 }
}
await Promise.all(Array.from({length:6},()=>worker()))
matches.sort((a,b)=>a.distance-b.distance)
console.log('MAMA_MATCH_SUMMARY '+JSON.stringify({urlCount:urls.length,completed,errors}))
for(const item of matches.slice(0,15))console.log('MAMA_MATCH_TOP '+JSON.stringify(item))
