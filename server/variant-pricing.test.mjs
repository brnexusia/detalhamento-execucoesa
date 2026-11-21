import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVariantPrices, resolvedVariantPrices, variantUnitPrice } from './variant-pricing.mjs'
const variations = [{name:'Tamanho', options:['P','M','G']},{name:'Cor',options:['Preto','Branco']}]
const config = {group:'Tamanho',prices:{P:12,M:15}}
const product = {price:20,variations,variant_prices:config}
test('validates the configurable group and price',()=>{
  assert.deepEqual(normalizeVariantPrices(config,variations),config)
  assert.throws(()=>normalizeVariantPrices({group:'Tamanho',prices:{X:12}},variations))
  assert.throws(()=>normalizeVariantPrices({group:'Tamanho',prices:{P:-1}},variations))
  assert.equal(normalizeVariantPrices(null,variations),null)
})
test('selected options, unpriced fallback and old products',()=>{
  assert.equal(variantUnitPrice(product,{Tamanho:'P',Cor:'Preto'}),12)
  assert.equal(variantUnitPrice(product,{Tamanho:'M',Cor:'Branco'}),15)
  assert.equal(variantUnitPrice(product,{Tamanho:'G'}),20)
  assert.equal(variantUnitPrice({...product,variant_prices:null},{Tamanho:'P'}),20)
})
test('catalog-specific prices preserve their relative differences',()=>{
  assert.deepEqual(resolvedVariantPrices(product,30),{group:'Tamanho',prices:{P:18,M:22.5}})
  assert.equal(variantUnitPrice(product,{Tamanho:'G'},30),30)
  assert.equal(2*variantUnitPrice(product,{Tamanho:'P'})+3*variantUnitPrice(product,{Tamanho:'M'}),69)
})

test('unit, package and closed box can coexist as differently priced options', () => {
  const variations = [{name:'Embalagem',options:['Unidade','Pacote 6 un.','Caixa fechada 24 un.']}]
  const variant_prices = {group:'Embalagem',prices:{Unidade:5,'Pacote 6 un.':27,'Caixa fechada 24 un.':96}}
  const product = {price:5,variations,variant_prices}
  assert.deepEqual(normalizeVariantPrices(variant_prices,variations),variant_prices)
  assert.equal(variantUnitPrice(product,{Embalagem:'Unidade'}),5)
  assert.equal(variantUnitPrice(product,{Embalagem:'Pacote 6 un.'}),27)
  assert.equal(variantUnitPrice(product,{Embalagem:'Caixa fechada 24 un.'}),96)
  assert.equal(2*variantUnitPrice(product,{Embalagem:'Pacote 6 un.'})+variantUnitPrice(product,{Embalagem:'Caixa fechada 24 un.'}),150)
})
