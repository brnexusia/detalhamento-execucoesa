import {mkdir,writeFile} from 'node:fs/promises'
import {links} from './mama-public-album-links.mjs'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
const selected=[
  {album:9,photo:45},
  {album:1,photo:29},
  {album:1,photo:291},
  {album:4,photo:131},
  {album:18,photo:27},
  {album:18,photo:107},
  {album:3,photo:47},
  {album:3,photo:48},
  {album:13,photo:187},
  {album:18,photo:4},
  {album:1,photo:217},
  {album:4,photo:39},
  {album:0,photo:279},
  {album:3,photo:64},
]
const dir='/tmp/mama-ocr-samples'
await mkdir(dir,{recursive:true})
for(const x of selected){
 const [name,url]=links[x.album]
 const page=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
 if(!page.ok)throw Error('album unavailable '+name)
 const image=googlePhotosImageUrls(page.body,10000)[x.photo-1]
 if(!image)throw Error('image unavailable '+name+':'+x.photo)
 const hi=googlePhotosHighResolutionUrl(image)||image
 let content
 for(const source of [hi,image]){
  try{
    const res=await safeRequest(source,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:22000})
    if(res.ok&&res.buffer?.length){content=res.buffer;break}
  }catch{}
 }
 if(!content)throw Error('image download failed '+name+':'+x.photo)
 const fname=dir+'/'+String(x.album)+'-'+String(x.photo)+'.jpg'
 await writeFile(fname,content)
 console.log('MAMA_RAW_REFERENCE '+JSON.stringify({album:name,photo:x.photo,bytes:content.length}))
}
