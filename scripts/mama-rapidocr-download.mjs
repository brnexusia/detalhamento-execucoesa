import {mkdir,writeFile} from 'node:fs/promises'
import sharp from 'sharp'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
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


const missing=[
 [3,54],[5,39],[5,119],[5,131],[5,141],[6,14],[6,19],[6,38],[7,1],[8,9],[8,104],[8,105],[20,27],[20,40]
]
await mkdir('/tmp/mama-rapid',{recursive:true})
for(const [album,photo] of missing){
 const [name,url]=links[album-1]
 const page=await safeRequest(url,{accept:'text/html,application/xhtml+xml',maxBytes:24*1024*1024,timeout:20000})
 if(!page.ok)throw Error('album missing '+album)
 const images=googlePhotosImageUrls(page.body,10000)
 const imageUrl=googlePhotosHighResolutionUrl(images[photo-1])||images[photo-1]
 const res=await safeRequest(imageUrl,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:20000})
 if(!res.ok)throw Error('failed photo '+album+' '+photo)
 const img=await sharp(res.buffer).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer()
 const filename='/tmp/mama-rapid/'+album+'-'+photo+'.png'
 await writeFile(filename,img)
 console.log('MAMA_RAPID_DOWNLOADED '+JSON.stringify({album,photo,name,bytes:img.length}))
}
