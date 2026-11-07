import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { collectPdfCatalog } from './scanner-pdf.mjs'

async function makeImage(r,g,b,width=600,height=700){
 return sharp({create:{width,height,channels:3,background:{r,g,b}}}).png().toBuffer()
}
function pdfFrom(build) {
 return new Promise((resolve,reject)=>{
   const doc=new PDFDocument({autoFirstPage:false,size:[810,1440],compress:false})
   const chunks=[]
   doc.on('data',chunk=>chunks.push(chunk))
   doc.on('error',reject)
   doc.on('end',()=>resolve(Buffer.concat(chunks)))
   build(doc)
   doc.end()
 })
}

test('real multi-page numbered catalog links photo badge 02 to price 02 while preserving separate looks', {timeout:60000}, async()=>{
 const main=await makeImage(205,160,125,750,1150)
 const board=await makeImage(75,155,205,500,350)
 const file=await pdfFrom(doc=>{
   doc.addPage().fontSize(28).text('LUME COLEÇÃO',40,65)
   doc.addPage().image(main,20,50,{width:760,height:1150})
   doc.fontSize(30).text('1',520,200)
   doc.fontSize(30).text('2',190,680)
   doc.fontSize(27).text('01 R$ 15,00',55,1290)
   doc.text('02 R$ 44,00',55,1340)
   doc.addPage().fontSize(25).text('CORES DISPONÍVEIS',40,70)
   doc.fontSize(23).text('BRINCO 01',50,245).image(board,130,350,{width:400})
   // Second look uses number 01 again; prices must not cross looks.
   doc.addPage().image(main,20,50,{width:760,height:1150})
   doc.fontSize(30).text('1',520,220)
   doc.fontSize(25).text('01 R$ 19,00',55,1310)
   doc.addPage().fontSize(25).text('CORES DISPONÍVEIS',40,70)
   doc.fontSize(23).text('BRINCO 01',50,245).image(board,130,350,{width:400})
 })
 const uploads=[]
 const parsed=await collectPdfCatalog(file,{
  onImage:async(bytes,mime,filename)=>{
   assert.equal(mime,'image/webp')
   assert.ok(bytes.length>100)
   uploads.push(filename)
   return '/media/'+crypto.randomUUID()
  },
 })
 assert.equal(parsed.candidates.length,3)
 const [first,second,other]=parsed.candidates
 console.info('NUMBERED_DEBUG',JSON.stringify(parsed.candidates.map(x=>({title:x.title,price:x.price,page:x.pdf_page,detail:x.pdf_detail_page,images:x.images.length,method:x.pdf_image_match_method,item:x.pdf_item_number}))))
 assert.deepEqual(parsed.candidates.map(x=>x.price),[15,44,19])
 assert.equal(second.pdf_item_number,2)
 assert.equal(second.pdf_page,2)
 assert.equal(second.images.length,1,'missing board label: use badge 02 on numbered photo')
 assert.equal(second.pdf_image_match_method,'number_marker')
 assert.equal(second.pdf_image_source_page,2)
 assert.equal(second.pdf_review_required,true)
 assert.match(second.description,/REVISÃO OBRIGATÓRIA.*marcador numérico 2/)
 assert.ok(first.images.length>0,'existing exact supplier board photo should stay')
 assert.ok(other.images.length>0,'number 01 in new look is a separate item')
 assert.notEqual(second.images[0],other.images[0])
 assert.ok(uploads.length>=3)
})

test('real multi-product PDF connects per-column photo/price to title, never to neighbor', {timeout:60000}, async()=>{
 const left=await makeImage(220,75,75,430,310)
 const right=await makeImage(70,100,215,430,310)
 const pdf=await new Promise((resolve,reject)=>{
   const doc=new PDFDocument({autoFirstPage:false,size:[810,720]})
   const chunks=[]
   doc.on('data',chunk=>chunks.push(chunk))
   doc.on('end',()=>resolve(Buffer.concat(chunks)))
   doc.on('error',reject)
   doc.addPage()
   doc.image(left,30,70,{width:300,height:220})
   doc.image(right,470,100,{width:300,height:220})
   doc.fontSize(19).text('Vestido Azul',50,395)
   doc.fontSize(18).text('R$ 29,90',50,438)
   doc.fontSize(19).text('Blusa Rosa',480,500)
   doc.fontSize(18).text('R$ 79,90',480,543)
   doc.end()
 })
 const images=[]
 const result=await collectPdfCatalog(pdf,{onImage:async(buf,mime)=>{
   images.push(await sharp(buf).stats())
   return '/media/'+crypto.randomUUID()
 }})
 assert.equal(result.candidates.length,2)
 const byTitle=new Map(result.candidates.map(x=>[x.title,x]))
 assert.equal(byTitle.get('Vestido Azul')?.price,29.9)
 assert.equal(byTitle.get('Blusa Rosa')?.price,79.9)
 assert.ok(result.candidates.every(x=>x.images.length===1),'each product receives its column crop')
 assert.ok(result.candidates.every(x=>x.pdf_review_required===true))
 assert.ok(result.candidates.every(x=>x.pdf_image_match_method==='above_label_proximity'))
})
