import test from 'node:test'
import assert from 'node:assert/strict'
import {baselineSourceKeys,canonicalSourcePhotoKey,matchMissedPhotoBySourceIdentity} from './mama-baseline-source-keys.mjs'
import {baselineMissing} from './mama-review-99p5.mjs'

test('audit snapshot contains 117 individually anchored Google images',()=>{
  const n=Object.values(baselineSourceKeys).reduce((sum,rows)=>sum+Object.keys(rows).length,0)
  assert.equal(n,117)
  const keys=Object.values(baselineSourceKeys).flatMap(rows=>Object.values(rows))
  assert.equal(new Set(keys).size,keys.length,'Google original key must be unique for all missing items')
  assert.ok(keys.every(key=>/^[a-zA-Z0-9_-]{22}$/.test(key)))
})

test('reordering or adding photos never shifts a verified price to a different photo',()=>{
  const expected=baselineSourceKeys['9']['45']
  const other=baselineSourceKeys['9']['17']
  const links=[
    'https://lh3.googleusercontent.com/pw/randomNEWPHOTO00000000000000000=w800-h1000',
    'https://lh3.googleusercontent.com/pw/unchanged-'+expected+'=w800-h1000',
    'https://lh3.googleusercontent.com/pw/unchanged-'+other+'=w800-h1000',
  ]
  assert.equal(canonicalSourcePhotoKey(links[1]),expected)
  const matched=matchMissedPhotoBySourceIdentity(9,links)
  assert.equal(matched.find(item=>item.baselinePhoto===45).currentPhoto,2)
  assert.equal(matched.find(item=>item.baselinePhoto===17).currentPhoto,3)
  assert.ok(matched.some(item=>item.imageUrl===null),'absent image stays absent instead of reusing a different index')
})

test('private or spoofed hosts cannot satisfy identity checks',()=>{
  const key=baselineSourceKeys['0']['94']
  for(const url of [
    'https://evil.example/pw/'+key,
    'https://lh3.googleusercontent.com.evil.example/pw/'+key,
    'file:///tmp/pw/'+key,
  ])assert.equal(canonicalSourcePhotoKey(url),'')
})
