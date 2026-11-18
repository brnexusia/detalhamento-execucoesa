import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedMamaVisualPrices, confirmedMamaVisualDecisions, confirmedUnitPricesByBaselinePhoto, confirmedNoUnitPriceByBaselinePhoto } from '../scripts/mama-reviewed-prices-20261118.mjs'
import { baselineSourceKeys } from '../scripts/mama-baseline-source-keys.mjs'
import { links } from '../scripts/mama-public-album-links.mjs'

test('77 unit prices were checked visually against the original 2026-11-16 photos',()=>{
  const result=confirmedMamaVisualPrices()
  assert.equal(Object.keys(result).length,77)
  assert.ok(Object.values(result).every(price=>Number.isFinite(price)&&price>0))
  assert.equal(new Set(Object.keys(result)).size,77)
})

test('visual price never relies on mutable album position',()=>{
  const decisions=confirmedMamaVisualPrices()
  for(const [album,photos] of Object.entries(confirmedUnitPricesByBaselinePhoto)){
    for(const [index,price] of Object.entries(photos)){
      const originalKey=baselineSourceKeys[album][index]
      assert.equal(decisions[links[Number(album)][1]+'#photo:'+originalKey],price)
    }
  }
})

test('a dozen price is never substituted for the unit price',()=>{
  const prices=confirmedUnitPricesByBaselinePhoto[13]
  assert.equal(prices[187],5)
  assert.equal(prices[188],10)
  assert.equal(prices[192],9)
  assert.equal(confirmedUnitPricesByBaselinePhoto[18][106],38)
  assert.equal(confirmedUnitPricesByBaselinePhoto[18][107],16)
  assert.equal(confirmedUnitPricesByBaselinePhoto[18][64],18)
  assert.equal(confirmedUnitPricesByBaselinePhoto[18][85],30)
})

test('photos without a clear label are deliberately not filled',()=>{
  const decisions=confirmedMamaVisualPrices()
  for(const [album,photos] of [[6,[1]],[7,[139]],[10,[205,288]],[14,[15,67]]]){
    for(const photo of photos){
      const key=baselineSourceKeys[String(album)]?.[String(photo)]
      if(key)assert.equal(decisions[links[album][1]+'#photo:'+key],undefined)
    }
  }
})


test('22 photos without a unit price remain explicitly unpriced',()=>{
  const all=confirmedMamaVisualDecisions()
  assert.equal(Object.keys(all).length,99)
  assert.equal(Object.values(all).filter(x=>x!==null).length,77)
  assert.equal(Object.values(all).filter(x=>x===null).length,22)
  for(const [album,photos] of Object.entries(confirmedNoUnitPriceByBaselinePhoto)){
    for(const photo of photos){
      const sourceKey=baselineSourceKeys[album][String(photo)]
      assert.equal(all[links[Number(album)][1]+'#photo:'+sourceKey],null)
    }
  }
})

test('conservative recognized coverage exceeds 99.5% only on photos with a unit-price label',()=>{
  const auditPhotos=3980
  const previousOcrRecognized=3863
  const recoveredVisually=Object.keys(confirmedMamaVisualPrices()).length
  const confirmedWithoutUnit=Object.values(confirmedMamaVisualDecisions()).filter(x=>x===null).length
  const eligibleUpperBound=auditPhotos-confirmedWithoutUnit
  // This is only a coverage bound for the November 16 snapshot.
  // It is NOT proof that unit-price OCR has >= 99.5% exact price accuracy,
  // nor that production database publication is complete.
  const coverage=(previousOcrRecognized+recoveredVisually)/eligibleUpperBound
  assert.ok(coverage>=0.995,JSON.stringify({coverage,eligibleUpperBound}))
  assert.ok(coverage<1)
})
