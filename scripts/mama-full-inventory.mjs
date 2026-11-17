import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosDetailUrls} from '../server/scanner-photo-albums.mjs'
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

let total=0
for(let i=0;i<links.length;i++){
 const [name,url]=links[i]
 try{
 const r=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
 if(!r.ok) throw Error('HTTP '+r.status)
 const images=googlePhotosImageUrls(r.body,10000),details=googlePhotosDetailUrls(r.body,r.url,10000)
 total+=Math.max(images.length,details.length)
 console.log('MAMA_FULL_INVENTORY '+JSON.stringify({index:i+1,name,images:images.length,details:details.length,count:Math.max(images.length,details.length),url}))
 }catch(e){console.log('MAMA_FULL_INVENTORY '+JSON.stringify({index:i+1,name,error:e.message,url}))}
}
console.log('MAMA_FULL_INVENTORY_SUMMARY '+JSON.stringify({albums:links.length,estimatedPhotos:total}))
