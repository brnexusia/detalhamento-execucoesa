import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosDetailUrls} from '../server/scanner-photo-albums.mjs'
const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const response=await safeRequest(album,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:18000})
if(!response.ok)throw new Error('Could not access public album')
const images=googlePhotosImageUrls(response.body,25)
const detail=googlePhotosDetailUrls(response.body,response.url,25)
console.log('MAMA_PHOTO_LINK_META '+JSON.stringify({images:images.length,details:detail.length,album:response.url}))
for(const index of [12,13,14,15,16]){
 console.log('MAMA_PHOTO_LINK '+JSON.stringify({index,image:images[index-1],detail:detail[index-1]||null}))
}
