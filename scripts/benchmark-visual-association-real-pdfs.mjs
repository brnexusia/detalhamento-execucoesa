import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { collectPdfCatalog } from '../server/scanner-pdf.mjs'

const files=[
 {file:'pdf-fixtures/Lume.pdf',name:'Lume',expected:55,minBaselinePhotos:28,expectedPrices:53},
 {file:'pdf-fixtures/MemoriesDropII.pdf',name:'Memories Drop II',expected:59,minBaselinePhotos:44,expectedPrices:59},
]
const results=[]
for(const source of files){
  const buffer=await readFile(source.file)
  const uploaded=[]
  const started=Date.now()
  const output=await collectPdfCatalog(buffer,{
    onImage:async(data,mime,filename)=>{
      assert.equal(mime,'image/webp')
      uploaded.push({bytes:data.length,name:filename})
      return '/media/test-photo-'+uploaded.length
    },
  })
  const photos=output.candidates.filter(x=>x.images?.length).length
  const validPrices=output.candidates.filter(x=>Number(x.price)>0).length
  const numbered=output.candidates.filter(x=>x.pdf_image_match_method==='number_marker')
  const proposed=output.candidates.filter(x=>x.pdf_image_match_method==='above_label_proximity')
  const values=output.candidates.map(x=>({name:x.title,price:x.price,
    page:x.pdf_page,number:x.pdf_item_number,detail:x.pdf_detail_page,
    images:x.images?.length||0,method:x.pdf_image_match_method,
    review:x.pdf_review_required===true}))
  const summary={name:source.name,expected:source.expected,found:output.candidates.length,
    priced:validPrices,withPhotos:photos,previousPhotos:source.minBaselinePhotos,
    numberedCropCount:numbered.length,approximateCropCount:proposed.length,
    allCropsForReview:[...numbered,...proposed].every(x=>x.pdf_review_required===true),
    durationSeconds:Math.round((Date.now()-started)/100)/10,
    candidates:values}
  results.push(summary)
  console.info('REAL_CATALOG',JSON.stringify({...summary,candidates:undefined}))
  assert.equal(summary.found,source.expected,'never lose verified references')
  assert.equal(summary.priced,source.expectedPrices,'never guess missing cents or lose prices')
  assert.ok(summary.withPhotos>=source.minBaselinePhotos,'never regress photo coverage')
  assert.equal(summary.allCropsForReview,true,'all approximate crops require review')
}
await mkdir('artifacts/pdf-visual',{recursive:true})
await writeFile('artifacts/pdf-visual/results.json',JSON.stringify(results,null,2))
