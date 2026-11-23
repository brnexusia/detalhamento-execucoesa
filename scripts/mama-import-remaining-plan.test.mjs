import test from 'node:test'
import assert from 'node:assert/strict'
import {remainingMamaAlbums,ALREADY_IMPORTED_MAMA_URLS,mamaFolderSlug} from './mama-import-remaining-plan.mjs'
test('remaining Mama batch excludes exactly four previously imported links and maps 17 official folder names',()=>{
 const list=remainingMamaAlbums()
 assert.equal(list.length,17)
 assert.equal(new Set(list.map(a=>a.url)).size,17)
 assert.equal(new Set(list.map(a=>mamaFolderSlug(a.displayName))).size,17)
 assert.equal(list.some(a=>a.name==='Colares - Aros'),true,'Colares - Aros was not verified as imported')
 for(const album of list){
  assert.ok(album.displayName.includes('MAMABijoux®')||album.displayName.includes('MAMAbijoux®'))
  assert.equal(ALREADY_IMPORTED_MAMA_URLS.has(album.url),false)
 }
})
