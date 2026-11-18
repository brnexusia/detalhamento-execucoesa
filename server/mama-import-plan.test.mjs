import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalMamaName, mamaPhotoSku, mamaStablePhotoSku, prepareMamaPhoto } from './mama-import-plan.mjs'
import { importPublishGroupHash } from './scanner-import-grouping.mjs'

const album='https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'
const media='/media/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

test('single account target is accent insensitive but exact',()=>{
  assert.equal(canonicalMamaName('MAMA Acessórios'),'mama acessorios')
  assert.notEqual(canonicalMamaName('Mama Bijoux Distribuidora'),'mama acessorios')
})

test('a photo receives a stable source-identity SKU across reruns',()=>{
  const a=mamaPhotoSku(album,'foto-0001')
  assert.equal(a,mamaPhotoSku(album,'foto-0001'))
  assert.notEqual(a,mamaPhotoSku(album,'foto-0002'))
  assert.match(a,/^MAMA-[A-F0-9]{22}$/)
  assert.throws(()=>mamaPhotoSku('https://evil.example/','foto-0001'))
})

test('a printed price and local image become a selected candidate with original reference retained',()=>{
  const normalized={name:'Brinco de argola',sku:'ref-2026',price:17.5,images:[media],media_url:media}
  const prepared=prepareMamaPhoto({album:'Brincos',albumUrl:album,
    candidate:{external_id:'foto-0001'},normalized})
  assert.equal(prepared.eligible,true)
  assert.equal(prepared.data.name,'Brinco de argola')
  assert.equal(prepared.data.price,17.5)
  assert.equal(prepared.data.category,'Brincos')
  assert.match(prepared.data.description,/ref-2026/)
  assert.equal(normalized.sku,'ref-2026')
  assert.deepEqual(prepared.data.images,[media])
})

test('a priced but unlabeled photo gets a transparent generic name rather than an invented description',()=>{
  const r=prepareMamaPhoto({album:'Lenços de Verão',albumUrl:album,
    candidate:{external_id:'foto-0012'},
    normalized:{name:'Foto importada 012',price:25,images:[media]}})
  assert.equal(r.eligible,true)
  assert.equal(r.data.name,'Lenços de Verão · Foto 0012')
})

test('missing or unknown prices and external photos do not publish',()=>{
  for(const price of [null,0,-1,NaN,'']) {
    const r=prepareMamaPhoto({album:'Brincos',albumUrl:album,
      candidate:{external_id:'foto-0001'},normalized:{name:'Brinco',price,images:[media]}})
    assert.equal(r.eligible,false)
  }
  const foreign=prepareMamaPhoto({album:'Brincos',albumUrl:album,
    candidate:{external_id:'foto-0001'},
    normalized:{name:'Brinco',price:7,images:['https://example.com/1.jpg']}})
  assert.deepEqual(foreign,{eligible:false,reason:'missing_local_image'})
})

test('distinct Google Photos products in one album cannot be merged by publisher',()=>{
  const first=importPublishGroupHash({source_url:album+'#foto-0001',name:'Brinco',price:7},
    {sourcePlatform:'google-photos',externalId:'foto-0001'})
  const second=importPublishGroupHash({source_url:album+'#foto-0002',name:'Brinco',price:7},
    {sourcePlatform:'google-photos',externalId:'foto-0002'})
  assert.notEqual(first,second)
  assert.equal(first,importPublishGroupHash({source_url:album+'#foto-0001',name:'Brinco',price:7},
    {sourcePlatform:'google-photos',externalId:'foto-0001'}))
  assert.throws(()=>importPublishGroupHash({source_url:album},{sourcePlatform:'google-photos'}))
})


test('visual sticker price stays with the original Google photo after album reorder',()=>{
  const photoKey='AbCd1234567890efGHIJKL'
  const first=prepareMamaPhoto({
    album:'Anéis',albumUrl:album,
    candidate:{external_id:'foto-0045',source_image_key:photoKey},
    normalized:{name:'Anel',price:7,media_url:media,images:[media]},
    requireStableIdentity:true,
  })
  const afterReorder=prepareMamaPhoto({
    album:'Anéis',albumUrl:album,
    candidate:{external_id:'foto-0053',source_image_key:photoKey},
    normalized:{name:'Anel',price:7,media_url:media,images:[media]},
    requireStableIdentity:true,
  })
  assert.equal(first.data.sku,afterReorder.data.sku)
  assert.equal(first.data.sku,mamaStablePhotoSku(album,photoKey))
  assert.notEqual(first.data.sku,mamaStablePhotoSku(album,'abcdefghij123456789012'))
  assert.throws(()=>prepareMamaPhoto({
    album:'Anéis',albumUrl:album,
    candidate:{external_id:'foto-0045'},normalized:{name:'Anel',price:7,media_url:media,images:[media]},
    requireStableIdentity:true,
  }),/identidade/)
})


test('publisher uses immutable Google photo ID, not mutable album index',()=>{
  const source='https://photos.google.com/share/mama-album'
  const imageKey='AbCd1234567890efGHIJKL'
  const first=importPublishGroupHash({source_url:source+'#foto-0045'},
    {sourcePlatform:'google-photos',externalId:'foto-0045',sourceImageKey:imageKey})
  const shifted=importPublishGroupHash({source_url:source+'#foto-0053'},
    {sourcePlatform:'google-photos',externalId:'foto-0053',sourceImageKey:imageKey})
  const another=importPublishGroupHash({source_url:source+'#foto-0054'},
    {sourcePlatform:'google-photos',externalId:'foto-0054',sourceImageKey:'abcdefghij123456789012'})
  assert.equal(first,shifted)
  assert.notEqual(first,another)
})
