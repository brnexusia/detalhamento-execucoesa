import test from 'node:test'
import assert from 'node:assert/strict'
import { stageSelectedImportMedia } from './scanner-publish-media.mjs'

function mockJob(data, status='review') {
  const rows=data.map((value,index)=>({
    id:String(index+1).padStart(4,'0'),media_revision:'2026-11-06 12:00:00.123456+00',
    data:value, selected:true, publish_result:'',
    source_product_id:value.source_product_id,
    job_source_url:value.job_source_url,
    job_platform:value.job_platform,
  }))
  const updates=[]
  const exclusions=[]
  const metadata={selected_count:rows.length,skipped_no_image_count:0}
  const query=async (sql,params)=>{
    if (sql.startsWith('SELECT status FROM import_jobs')) return {rowCount:1,rows:[{status}]}
    if (sql.includes('SELECT COUNT(*)::int AS count FROM import_normalized_products')) {
      return {rowCount:1,rows:[{count:rows.filter(row=>row.selected).length}]}
    }
    if (sql.includes('FROM import_normalized_products n') && sql.includes('SELECT n.id,n.updated_at::text')) {
      const next=rows.filter(row=>row.selected&&row.id>params[2]).slice(0,25)
      return {rowCount:next.length,rows:next}
    }
    if (sql.includes('UPDATE import_normalized_products n') && sql.includes('SET selected=false')) {
      const row=rows.find(row=>row.id===params[0]&&row.selected)
      if(!row)return {rowCount:0,rows:[]}
      row.selected=false
      row.publish_result='skipped_no_image'
      exclusions.push({id:row.id,name:row.data.name,sql})
      return {rowCount:1,rows:[]}
    }
    if (sql.includes('UPDATE import_normalized_products n')) {
      const row=rows.find(row=>row.id===params[3]&&row.selected)
      if(!row)return {rowCount:0,rows:[]}
      row.data=JSON.parse(params[0])
      updates.push({data:row.data,warnings:JSON.parse(params[1]),revision:params[6],sql})
      return {rowCount:1,rows:[]}
    }
    if (sql.includes('UPDATE import_jobs j')) {
      metadata.selected_count=rows.filter(row=>row.selected).length
      metadata.skipped_no_image_count=rows.filter(row=>!row.selected&&row.publish_result==='skipped_no_image').length
      return {rowCount:1,rows:[metadata]}
    }
    throw new Error('Unexpected SQL: '+sql)
  }
  return {query,updates,exclusions,metadata,rows}
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

test('reuses already scanned FácilZap import with corrected store-scoped source URL',async()=>{
  const state=mockJob([{
    name:'Brinco Aço Inox',price:45,
    job_platform:'facilzap',
    job_source_url:'https://facilzap.com.br/galegobijooux',
    source_product_id:'4419956',
    source_url:'https://facilzap.com.br/produto/4419956',
    media_url:'https://arquivos.facilzap.app.br/produtos/404.webp',
    images:['https://arquivos.facilzap.app.br/produtos/404.webp'],
  }])
  let source=''
  await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-facilzap',
    localize:async ({sourceUrl})=>{
      source=sourceUrl
      return {mediaUrl:'/media/brinco-inox',images:['/media/brinco-inox'],variantImages:[],failed:1}
    },
  })
  assert.equal(source,'https://facilzap.com.br/galegobijooux/produto/4419956',
    'Recover from shop-specific product detail URL, not /produto/ID without shop')
  assert.equal(state.updates[0].data.source_url,source,
    'Repair source URL in current review without scanning again')
  assert.deepEqual(state.updates[0].data.images,['/media/brinco-inox'])
})

test('preserves explicit nonstandard FácilZap product permalinks when already correct',async()=>{
  const manual='https://loja.example.br/colecoes/brinco-inox-2450312'
  const state=mockJob([{
    name:'Brinco Aço Inox',price:45,job_platform:'facilzap',
    job_source_url:'https://loja.example.br/',source_product_id:'2450312',
    source_url:manual,
    media_url:'https://arquivos.facilzap.app.br/produtos/404.webp',
    images:['https://arquivos.facilzap.app.br/produtos/404.webp'],
  }])
  let source=''
  await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-facilzap',
    localize:async ({sourceUrl})=>{
      source=sourceUrl
      return {mediaUrl:'/media/correct',images:['/media/correct'],variantImages:[],failed:0}
    },
  })
  assert.equal(source,manual,'Do not overwrite a verified shop-specific permalink with a guessed product route')
  assert.equal(state.updates[0].data.source_url,manual)
})

test('skips product with 404 photo instead of blocking publication',async()=>{
  const state=mockJob([{name:'Brinco Aço Inox',price:50,source_url:'https://facilzap.com.br/galegobijooux/produto/4419956',
    media_url:'https://arquivos.facilzap.app.br/produtos/1787876125_fb3aa3165caa45e86750.webp',
    images:['https://arquivos.facilzap.app.br/produtos/1787876125_fb3aa3165caa45e86750.webp']}])
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>({mediaUrl:'https://arquivos.facilzap.app.br/produtos/1787876125_fb3aa3165caa45e86750.webp',images:[],variantImages:[],failed:1,
      failureReasons:['arquivos.facilzap.app.br: HTTP 404 ao baixar a foto']}),
  })
  assert.equal(result.failed,1)
  assert.equal(result.skippedNoImage,1)
  assert.deepEqual(state.exclusions.map(x=>x.name),['Brinco Aço Inox'])
  assert.equal(state.rows[0].selected,false)
  assert.equal(state.rows[0].data.name,'Brinco Aço Inox','Keep original review data')
  assert.equal(state.rows[0].publish_result,'skipped_no_image')
  assert.equal(state.metadata.selected_count,0)
  assert.equal(state.metadata.skipped_no_image_count,1)
})

test('skips expired signed photo without exposing its token',async()=>{
  const state=mockJob([{name:'Brinco Importado',price:45,
    source_url:'https://galego.example/produto/123',
    media_url:'https://cdn.example/photo.webp?token=secret',
    images:['https://cdn.example/photo.webp?token=secret']}])
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>({mediaUrl:'https://cdn.example/photo.webp?token=secret',
      images:[],variantImages:[],failed:1,
      failureReasons:['cdn.example: HTTP 403 ao baixar a foto']}),
  })
  assert.equal(result.failed,1)
  assert.equal(state.updates.length,0)
  assert.equal(state.exclusions.length,1)
  assert.ok(!JSON.stringify(state.exclusions).includes('token=secret'))
})

test('excludes multiple broken-photo items and keeps valid images',async()=>{
  const state=mockJob([
    {name:'Brinco Importado',price:20,media_url:'https://cdn.example/1.webp',images:['https://cdn.example/1.webp']},
    {name:'Brinco Aço Inox',price:29,media_url:'https://cdn.example/2.webp',images:['https://cdn.example/2.webp']},
    {name:'Pulseira com foto',price:39,media_url:'https://cdn.example/3.webp',images:['https://cdn.example/3.webp']},
  ])
  const checked=[]
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async({product})=>{
      checked.push(product.name)
      return product.name==='Pulseira com foto'
        ? {mediaUrl:'/media/valid-3',images:['/media/valid-3'],variantImages:[],failed:0}
        : {mediaUrl:product.media_url,images:[],variantImages:[],failed:1,
          failureReasons:['cdn.example: HTTP 404 ao baixar a foto']}
    },
  })
  assert.deepEqual(checked,['Brinco Importado','Brinco Aço Inox','Pulseira com foto'])
  assert.equal(result.failed,2)
  assert.equal(result.staged,1)
  assert.deepEqual(state.exclusions.map(x=>x.name),['Brinco Importado','Brinco Aço Inox'])
  assert.equal(state.rows[2].selected,true)
  assert.equal(state.updates.length,1)
  assert.deepEqual(state.updates[0].data.images,['/media/valid-3'])
  assert.equal(state.metadata.selected_count,1)
  assert.equal(state.metadata.skipped_no_image_count,2)
})

test('excludes source products with no photo URLs at all',async()=>{
  const state=mockJob([
    {name:'Item sem imagem',price:30,images:[],media_url:''},
    {name:'Item PDF com foto',price:60,images:['/media/pdf-123'],media_url:'/media/pdf-123'},
  ])
  const result=await stageSelectedImportMedia({
    query:state.query,storeId:'store-1',jobId:'job-1',
    localize:async()=>{throw new Error('Should not fetch remote image')},
  })
  assert.equal(result.failed,1)
  assert.equal(state.exclusions[0].name,'Item sem imagem')
  assert.equal(state.rows[1].selected,true)
  assert.equal(state.metadata.selected_count,1)
  assert.equal(state.metadata.skipped_no_image_count,1)
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
