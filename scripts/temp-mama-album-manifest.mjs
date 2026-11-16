// MAMA: live album inventory, read-only. Exactly one task for each
// of the 21 Google Photos albums advertised on the merchant's Linktree.
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosDetailUrls} from '../server/scanner-photo-albums.mjs'
import {writeFile,mkdir} from 'node:fs/promises'
import {links} from './mama-public-album-links.mjs'

const index=Number(process.env.MAMA_ALBUM_INDEX ?? '-1')
if(!Number.isInteger(index)||index<0||index>=links.length)throw Error('Invalid album index')
const [album,url]=links[index]
let result={index:index+1,album,url,images:0,detailPages:0,allUrlsPublic:false}
try {
 const response=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
 result.status=response.status
 result.redirectedHost=new URL(response.url||url).hostname
 if(!response.ok||result.redirectedHost!=='photos.google.com')throw Error('Album inaccessible')
 const images=googlePhotosImageUrls(response.body,10000)
 const details=googlePhotosDetailUrls(response.body,response.url,10000)
 result.images=images.length;result.detailPages=details.length
 result.allUrlsPublic=images.length>0 || details.length>0
 result.enumerationMode=images.length>1?'image-urls':'detail-pages'
 if(!result.allUrlsPublic)throw Error('No public image candidates discovered')
} catch (e){result.error=String(e?.message||e)}
console.log('MAMA_ALBUM_MANIFEST '+JSON.stringify(result))
await mkdir('/tmp/mama-full-manifest',{recursive:true})
await writeFile('/tmp/mama-full-manifest/album-'+String(index+1).padStart(2,'0')+'.json',JSON.stringify(result,null,2))
if(result.error)process.exitCode=1
