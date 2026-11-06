import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVtexPublicProducts, collectVtexPublic } from './scanner-vtex-public.mjs'

const sample={
  productId:'1234',productName:'Camiseta Azul',productReference:'CAM-AZ',
  brand:'Marca X',description:'100% algodão',categories:['/Moda/Camisetas/'],
  linkText:'camiseta-azul',
  items:[
    {itemId:'sku1',name:'Camiseta Azul P',variations:['Tamanho'],Tamanho:['P'],
     images:[{imageUrl:'https://cdn.example/camiseta.jpg'}],
     sellers:[{sellerDefault:true,commertialOffer:{Price:59.9,ListPrice:79.9,AvailableQuantity:10}}]},
    {itemId:'sku2',name:'Camiseta Azul M',variations:['Tamanho'],Tamanho:['M'],
     sellers:[{sellerDefault:true,commertialOffer:{Price:55.9,AvailableQuantity:0}}]},
  ],
}

test('VTEX maps BRL major-unit prices, SKUs, images and variants from public schema',()=>{
  const p=normalizeVtexPublicProducts([sample],'https://shop.example')
  assert.equal(p.length,1)
  assert.equal(p[0].price,55.9)
  assert.equal(p[0].source_url,'https://shop.example/camiseta-azul/p')
  assert.equal(p[0].brand,'Marca X')
  assert.deepEqual(p[0].images,['https://cdn.example/camiseta.jpg'])
  assert.equal(p[0].variants.length,2)
  assert.equal(p[0].variants[0].properties[0].value,'P')
  assert.equal(p[0].variants[1].available,false)
  assert.equal(p[0].sku,'CAM-AZ')
})

test('unpriced VTEX items remain unpriced; never guess from ListPrice',()=>{
  const p=normalizeVtexPublicProducts([{...sample,items:[{
    itemId:'sku3',sellers:[{commertialOffer:{ListPrice:299.90,Price:0}}],
  }]}],'https://shop.example')
  assert.equal(p[0].price,null)
})

test('VTEX pages are read-only and streaming compatible',async()=>{
  const urls=[]
  const stored=[]
  const sink={count:0,async push(items){stored.push(...items);this.count+=items.length},async flush(){}}
  const result=await collectVtexPublic({
    rootResponse:{url:'https://shop.example/'},
    request:async(url,opts)=>{
      urls.push(url)
      assert.equal(opts.accept,'application/json')
      return {ok:true,status:200,body:JSON.stringify(urls.length===1?Array.from({length:20},(_,i)=>({...sample,productId:String(i+1)})):[])}
    },
    maxProducts:40,sink,onProgress:async()=>{},
  })
  assert.equal(result.candidateCount,20)
  assert.equal(result.pagesScanned,2)
  assert.ok(urls[0].includes('_from=0&_to=19'))
  assert.ok(urls[1].includes('_from=20&_to=39'))
})

test('VTEX HTTP 403 fails with a fallback-compatible error',async()=>{
  await assert.rejects(()=>collectVtexPublic({
    rootResponse:{url:'https://shop.example/'},
    request:async()=>({ok:false,status:403}),
    sink:{count:0},maxProducts:20,onProgress:async()=>{},
  }),/não disponibilizou/)
})
