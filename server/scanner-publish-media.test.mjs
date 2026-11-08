import test from 'node:test'
import assert from 'node:assert/strict'
import { stageSelectedImportMedia } from './scanner-publish-media.mjs'

function mockJob(data, status='review') {
  const rows=data.map((value,index)=>({
    id:String(index+1).padStart(4,'0'),media_revision:'2026-11-06 12:00:00.123456+00',
    data:value,
  }))
  const updates=[]
  const query=async (sql,params)=>{
    if (sql.startsWith('SELECT status FROM import_jobs')) return {rowCount:1,rows:[{status}]}
    if (sql.includes('SELECT COUNT(*)::int AS count FROM import_normalized_products')) {
      const count = rows.filter(row => [row.data?.media_url,
        ...(row.data?.images || []),
        ...(row.data?.variant_images || []).flatMap(v=>v.images||[])].some(x => String(x).startsWith('https://') || String(x).startsWith('http://'))).length
      return {rowCount:1,rows:[{count}]}
    }
    if (sql.includes('FROM import_normalized_products') && sql.includes('SELECT id,updated_at::text')) {
      const next=rows.filter(row=>row.id>params[2]).slice(0,25)
      return {rowCount:next.length,rows:next}
    }
    if (sql.includes('UPDATE import_normalized_products n')) {
      updates.push({data:JSON.parse(params[0]),warnings:JSON.parse(params[1]),revision:params[6],sql})
      return {rowCount:1,rows:[]}
    }
    throw new Error('Unexpected SQL: '+sql)
  }
  return {query,updates}
}

test('downloads remote media BEFORE publishing and stores only /media references',async()=>{
  const state=mockJob([{
    name:'Blusa Lume',price:69.9,source_url:'https://loja.example/produto/lume',
    images:['https://cdn.example/front.jpg','https://cdn.example/broken.jpg'],
    media_url:'https://cdn.example/front.jpg',
    variant_images:[{selections:{Cor:'Rosa'},images:['https://cdn.example/side.jpg']}],
  }])
  let localizationCalls=0
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async ()=>{
      localizationCalls++
      return {mediaUrl:'/media/front',images:['/media/front','https://cdn.example/broken.jpg'],
        variantImages:[{selections:{Cor:'Rosa'},images:['/media/side']}],failed:1}
    },
  })
  assert.equal(localizationCalls,1)
  assert.equal(result.staged,1)
  assert.equal(state.updates.length,1)
  assert.deepEqual(state.updates[0].data.images,['/media/front'])
  assert.equal(state.updates[0].data.media_url,'/media/front')
  assert.deepEqual(state.updates[0].data.variant_images[0].images,['/media/side'])
  assert.ok(!JSON.stringify(state.updates[0].data).includes('cdn.example/front.jpg'))
  assert.equal(state.updates[0].revision,'2026-11-06 12:00:00.123456+00')
})

test('keeps job in review when remote cover cannot be saved',async()=>{
  const state=mockJob([{name:'Camiseta sem foto',price:50,source_url:'https://store.example/p/1',
    media_url:'https://cdn.example/expired.jpg',images:['https://cdn.example/expired.jpg']}])
  await assert.rejects(()=>stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>({mediaUrl:'https://cdn.example/expired.jpg',images:[],variantImages:[],failed:1}),
  }),/continua em revisão/)
  assert.equal(state.updates.length,0)
})

test('does not re-download PDF images that were saved during scanning',async()=>{
  const state=mockJob([{name:'Vestido PDF',price:39.9,images:['/media/pdf-123'],media_url:'/media/pdf-123'}])
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>{throw new Error('Should not localize')},
  })
  assert.equal(result.staged,0)
  assert.equal(state.updates.length,0)
})

test('does not stage a job already published',async()=>{
  const state=mockJob([{name:'Blusa',price:29,images:['https://cdn.example/a.jpg']}],'completed')
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>{throw new Error('Should not localize')},
  })
  assert.equal(result.skipped,true)
})

test('reports real media progress and does not invent total from elapsed time',async()=>{
 const state=mockJob([
  {name:'Peça 1',price:25,media_url:'https://cdn.example/1.webp',images:['https://cdn.example/1.webp']},
  {name:'Peça 2',price:30,media_url:'https://cdn.example/2.webp',images:['https://cdn.example/2.webp']},
 ])
 const events=[]
 await stageSelectedImportMedia({
   query:state.query,storeId:'store-1',jobId:'job-1',
   onProgress:async event=>events.push(event),
   localize:async({product})=>({
     mediaUrl:product.media_url.includes('1.webp')?'/media/one':'/media/two',
     images:[product.media_url.includes('1.webp')?'/media/one':'/media/two'],
     variantImages:[],failed:0,
   }),
 })
 assert.deepEqual(events.map(e=>[e.phase,e.completed,e.total]),[
   ['images',0,2],['images',1,2],['images',2,2],['images',2,2],
 ])
})
