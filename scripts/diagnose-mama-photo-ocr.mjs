// Read-only diagnostic for four direct images from two MAMA public albums.
// No Linktree crawling, no production DB and no publication.
import { collectSharedPhotos } from '../server/scanner-photo-albums.mjs'
import { safeRequest } from '../server/scanner-collector.mjs'
import sharp from 'sharp'

const samples = [
  ['Brincos','https://photos.app.goo.gl/MfPcF9pjjdaNCWQf6'],
  ['Bolsas','https://photos.app.goo.gl/dMGADSscxXCJ3VXLA'],
]
let photos=0,named=0,priced=0,packs=0
for(const [label,link] of samples) {
  const products=[]
  const images=[]
  const result=await collectSharedPhotos(link,{
    request:safeRequest,maxProducts:4,collectInMemory:false,onProgress:async()=>{},
    onImage:async (bytes,mime,filename)=>{
      if(mime!=='image/webp')throw Error('Unexpected format')
      const meta=await sharp(bytes).metadata()
      if(meta.width<220||meta.height<220)throw Error('Image too small')
      images.push({size:bytes.length,width:meta.width,height:meta.height})
      return '/media/diagnostic-'+images.length
    },
    onBatch:async items=>products.push(...items),
  })
  const summary = {
    album:label,photos:result.candidateCount,skipped:result.skipped,
    products:products.map((p,index)=>({index:index+1,title:p.title,
      price:p.price,pack:p.pack,photo:p.images[0],description:p.description.slice(0,100)})),
  }
  console.log('MAMA_OCR_RESULT '+JSON.stringify(summary))
  photos+=products.length
  named+=products.filter(p=>!p.title.startsWith('Foto importada')).length
  priced+=products.filter(p=>p.price!==null).length
  packs+=products.filter(p=>p.pack).length
}
console.log('MAMA_OCR_SUMMARY '+JSON.stringify({photos,named,priced,packs,albumCount:samples.length}))
// As long as at least one label can be parsed, the end-to-end OCR path is active.
// Exact field quality is inspected before proposing a production merge.
if(!photos||!named||!priced)process.exitCode=1
