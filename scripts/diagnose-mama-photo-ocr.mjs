// Read-only diagnostic for four direct images from two MAMA public albums.
// No Linktree crawling, no production DB and no publication.
import { collectSharedPhotos } from '../server/scanner-photo-albums.mjs'
import { safeRequest } from '../server/scanner-collector.mjs'
import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { parseTesseractTsv } from '../server/scanner-pdf-tesseract.mjs'

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
      images.push({size:bytes.length,width:meta.width,height:meta.height,buffer:bytes})
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
  if(label==='Brincos') {
    for(let i=1;i<Math.min(4,images.length);i++){
      const img=images[i]
      const variants=[
        ['crop-53x18',.53,.18,6],
        ['crop-70x25',.70,.25,6],
        ['crop-82x38',.82,.38,6],
        ['crop-53x18-11',.53,.18,11],
      ]
      for(const [kind,width,height,psm] of variants){
        const crop=await sharp(img.buffer).extract({
          left:0,top:0,width:Math.ceil(img.width*width),
          height:Math.ceil(img.height*height),
        }).resize({width:1200}).grayscale().normalize().png().toBuffer()
        const out=spawnSync('prlimit',[
          '--as=1073741824','--cpu=12','--fsize=10485760','--',
          'tesseract','stdin','stdout','-l','por+eng','--psm',String(psm),'tsv',
        ],{input:crop,timeout:12000,maxBuffer:512*1024,encoding:'utf8'})
        const parsed=parseTesseractTsv(out.stdout||'')
        console.log('MAMA_OCR_VARIANT '+JSON.stringify({
          photo:i+1,kind,psm,status:out.status,
          lines:parsed.lines.slice(0,10).map(l=>({text:l.text,score:+l.score.toFixed(2)})),
        }))
      }
    }
  }
  photos+=products.length
  named+=products.filter(p=>!p.title.startsWith('Foto importada')).length
  priced+=products.filter(p=>p.price!==null).length
  packs+=products.filter(p=>p.pack).length
}
console.log('MAMA_OCR_SUMMARY '+JSON.stringify({photos,named,priced,packs,albumCount:samples.length}))
// As long as at least one label can be parsed, the end-to-end OCR path is active.
// Exact field quality is inspected before proposing a production merge.
if(!photos||!named||!priced)process.exitCode=1
