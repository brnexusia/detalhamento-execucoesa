import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buyerSearchPattern } from './buyer-discovery-search.mjs'

test('pesquisa palavras com espaços intermediários',()=>{
 assert.equal(buyerSearchPattern('  Bolsa   Busca 123  '),'%Bolsa%Busca%123%')
 assert.equal(buyerSearchPattern(''), '%%')
})
test('escapa curingas de ILIKE',()=>{
 assert.equal(buyerSearchPattern('100%_kit'),'%100\\%\\_kit%')
})
