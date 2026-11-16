// MAMA: live album inventory, read-only. Exactly one task for each
// of the 21 Google Photos albums advertised on the merchant's Linktree.
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosDetailUrls} from '../server/scanner-photo-albums.mjs'
import {writeFile,mkdir} from 'node:fs/promises'
export const links=[
 ['Catálogo Verão','https://photos.app.goo.gl/7rFBydymNf2Y5Lfi8'],
 ['Lenços de Verão','https://photos.app.goo.gl/uZJuTkVXgEcqDNye7'],
 ['Broches e Chaveiros','https://photos.app.goo.gl/xE7JWntJJRo7x1C76'],
 ['Brincos','https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
 ['Colares - Aros','https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9'],
 ['Colares e Maxi Colares','https://photos.app.goo.gl/vvusGG4cUbEfzvev7'],
 ['Colares Verniz','https://photos.app.goo.gl/4z14SLH91bxMENMX9'],
 ['Pulseiras e Braceletes','https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7'],
 ['Chokers e Colares Delicados','https://photos.app.goo.gl/4qNDWNyoEig83Dhn9'],
 ['Anéis','https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A'],
 ['Cintos','https://photos.app.goo.gl/RkuGaNQzA2CFNDCh6'],
 ['Acessórios Cabelo Infantil','https://photos.app.goo.gl/WFShKcZthyxqxshMA'],
 ['Catálogo Country','https://photos.app.goo.gl/iDwgxFiirce8UfsZ6'],
 ['Acessórios Cabelo Adulto','https://photos.app.goo.gl/uwUFrGa1iDKE7iDJ7'],
 ['Acessórios Masculinos','https://photos.app.goo.gl/nCj8X8TJ49puAto87'],
 ['Bolsas e Necessaires','https://photos.app.goo.gl/dMGADSscxXCJ3VXLA'],
 ['Copos e Porta-joias','https://photos.app.goo.gl/4ymqbWGkUmkzpaAa9'],
 ['Brasil Core','https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7'],
 ['Catálogo Inverno','https://photos.app.goo.gl/GmkVR55GHRgRmHP88'],
 ['Catálogo Inverno Infantil','https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9'],
 ['Festa Junina','https://photos.app.goo.gl/nHmUk4GjrziN5npD9']
]
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
