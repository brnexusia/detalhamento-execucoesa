import { links } from './mama-public-album-links.mjs'

// Explicitly excluded: the four albums confirmed by the store owner as already imported.
// The existing "Catálogo Colares" folder has no verified source-link association.
export const ALREADY_IMPORTED_MAMA_URLS=new Set([
 'https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6', // Brincos
 'https://photos.app.goo.gl/vvusGG4cUbEfzvev7', // Colares e Maxi Colares
 'https://photos.app.goo.gl/4z14SLH91bxMENMX9', // Colares Verniz
 'https://photos.app.goo.gl/QU8pBtNq5UWgh3Mg7', // Pulseiras e Braceletes
])

// Display names as published by the official Mama Bijoux Linktree.
export const OFFICIAL_MAMA_ALBUM_NAMES={
 'https://photos.app.goo.gl/7rFBydymNf2Y5Lfi8':'CATÁLOGO VERÃO MAMABijoux®',
 'https://photos.app.goo.gl/uZJuTkVXgEcqDNye7':'LENÇOS de VERÃO MAMABijoux®',
 'https://photos.app.goo.gl/xE7JWntJJRo7x1C76':'BROCHES & CHAVEIROS MAMABijoux®',
 'https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9':'COLARES - AROS MAMABijoux®',
 'https://photos.app.goo.gl/4qNDWNyoEig83Dhn9':'CHOKERS & COLARES DELICADOS MAMABijoux®',
 'https://photos.app.goo.gl/wEvtGcKiwPYVjZk6A':'ANEIS MAMABijoux®',
 'https://photos.app.goo.gl/RkuGaNQzA2CFNDCh6':'CINTOS MAMABijoux®',
 'https://photos.app.goo.gl/WFShKcZthyxqxshMA':'ACESSÓRIOS de CABELO(INFANTIL) MAMABijoux®',
 'https://photos.app.goo.gl/iDwgxFiirce8UfsZ6':'CATÁLOGO COUNTRY MAMABijoux®',
 'https://photos.app.goo.gl/uwUFrGa1iDKE7iDJ7':'ACESSÓRIOS de CABELO(ADULTO) MAMABijoux®',
 'https://photos.app.goo.gl/nCj8X8TJ49puAto87':'ACESSÓRIOS MASCULINOS MAMABijoux®',
 'https://photos.app.goo.gl/dMGADSscxXCJ3VXLA':'BOLSAS e NECESSEIRES MAMABijoux®',
 'https://photos.app.goo.gl/4ymqbWGkUmkzpaAa9':'COPOS & PORTA-JOIAS MAMABijoux®',
 'https://photos.app.goo.gl/XYcPE4m8Ejoam4yF7':'BRASIL CORE MAMABijoux®',
 'https://photos.app.goo.gl/GmkVR55GHRgRmHP88':'CATÁLOGO INVERNO MAMABijoux®',
 'https://photos.app.goo.gl/xfKFgSB6R5m9xqnk9':'CATÁLOGO INVERNO INFANTIL MAMABijoux®',
 'https://photos.app.goo.gl/nHmUk4GjrziN5npD9':'FESTA JUNINA MAMAbijoux®',
}
export function remainingMamaAlbums(){
 const all=new Set(links.map(([,url])=>url))
 if(links.length!==21||all.size!==21||ALREADY_IMPORTED_MAMA_URLS.size!==4)throw Error('A lista oficial dos 21 álbuns MAMA mudou; revise antes de importar.')
 if([...ALREADY_IMPORTED_MAMA_URLS].some(url=>!all.has(url)))throw Error('Exclusão de álbum não reconhecido.')
 const remaining=links.filter(([,url])=>!ALREADY_IMPORTED_MAMA_URLS.has(url)).map(([name,url])=>{
   const displayName=OFFICIAL_MAMA_ALBUM_NAMES[url]
   if(!displayName)throw Error('Álbum da MAMA sem nome oficial: '+url)
   return {name,url,displayName}
 })
 if(remaining.length!==17)throw Error('Esperados 17 álbuns restantes, encontrados '+remaining.length)
 return remaining
}
export const mamaFolderSlug=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'catalogo'
