import test from 'node:test'
import assert from 'node:assert/strict'
import { importPublishGroupHash, importParentKey } from './scanner-import-grouping.mjs'
import { planAlexandreRecovery } from './scanner-alexandre-recovery.mjs'

const mediaA='/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const mediaB='/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mediaC='/media/cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const data = (photo)=>({
  name:'BRINCO',description:'Peça original',sku:'',category:'BRINCO',brand:'Alexandre Bijoux',
  price:24,currency:'BRL',media_url:photo,images:[photo],variant_images:[],
  source_url:'https://bijouxalexandre.com.br/',source:'alexandre-bijoux-public-api',
})
const productRow = (id,external_id,photo,published_product_id='old-1')=>({
  id,external_id,published_product_id,publish_result:'created',data:data(photo),
})

test('Alexandre publisher must separate identical names/prices by source IDs',()=>{
  const a=data(mediaA),b=data(mediaB)
  assert.equal(importParentKey(a),importParentKey(b),'legacy root+name+price grouping reproduces issue')
  const hashA=importPublishGroupHash(a,{sourcePlatform:'alexandre-bijoux',externalId:'A'})
  const hashB=importPublishGroupHash(b,{sourcePlatform:'alexandre-bijoux',externalId:'B'})
  assert.notEqual(hashA,hashB)
  assert.throws(()=>importPublishGroupHash(a,{sourcePlatform:'alexandre-bijoux',externalId:''}),/sem ID/)
  assert.equal(importPublishGroupHash(a,{sourcePlatform:'alexandre-bijoux',externalId:'A'}),hashA)
})
test('Recovery keeps existing product ID and creates only missing distinct pieces',()=>{
  const rows=[
    productRow('r1','external-a',mediaA),
    productRow('r2','external-b',mediaB),
    productRow('r3','external-c',mediaC),
  ]
  const existing=[{id:'old-1',media_url:mediaB,active:true}]
  const plan=planAlexandreRecovery(rows,existing)
  assert.equal(plan.originals,1)
  assert.equal(plan.total,3)
  assert.equal(plan.retain[0].id,'r2')
  assert.equal(plan.retain[0].productId,'old-1')
  assert.deepEqual(plan.create.map(item=>item.id),['r1','r3'])
})
test('Recovery is idempotent once all source rows have unique mapped products',()=>{
  const rows=[productRow('r1','e1',mediaA,'p1'),productRow('r2','e2',mediaB,'p2')]
  const existing=[{id:'p1',active:true,media_url:mediaA},{id:'p2',active:true,media_url:mediaB}]
  const plan=planAlexandreRecovery(rows,existing)
  assert.equal(plan.create.length,0)
  assert.equal(plan.retain.length,2)
})
test('Recovery refuses partial histories, missing media, and duplicated origin IDs',()=>{
  const rows=[productRow('r1','e1',mediaA),productRow('r2','e1',mediaB)]
  const existing=[{id:'old-1',media_url:mediaA,active:true}]
  assert.throws(()=>planAlexandreRecovery(rows,existing),/duplicados/)
  assert.throws(()=>planAlexandreRecovery([productRow('r1','e1','https://example.com/item.webp')],existing),/remotas/)
  assert.throws(()=>planAlexandreRecovery([productRow('r1','e1','')],existing),/imagem interna/)
  assert.throws(()=>planAlexandreRecovery([productRow('r1','e1',mediaA)],[]),/removidos/)
})
