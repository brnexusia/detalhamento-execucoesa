import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedMamaVisualPrices, confirmedUnitPricesByBaselinePhoto } from '../scripts/mama-reviewed-prices-20261118.mjs'
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
