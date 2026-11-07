import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { collectPdfCatalog } from '../server/scanner-pdf.mjs'

const benchmarks=[
 {name:'Lume',file:'Lume.pdf',expected:55,sha:'2fddeef63f341675c21d19586279aab5455700e46deed8460a0b0b9d52b59a3a'},
 {name:'Costa',file:'Costa.pdf',expected:55,sha:'201f86ce629fef7dc898f2d09d66aaded4e1420fe84685a9d162e75a439e26ff'},
 {name:'Origem',file:'Origem.pdf',expected:37,sha:'ea53f22890635acc0b62e4a20df43a026c85e55dc0e923096d63dd895b908da9'},
 {name:'Memories',file:'Memories.pdf',expected:90,sha:'bf3048455626074f2b010392119755164eb737e4b88a22bc7e0dd3ec461200c0'},
 {name:'Memories Drop II',file:'MemoriesDropII.pdf',expected:59,sha:'f94852f2e23d0025eda099134d4d67d8b6a688fe0da0a72eec700ec09ad89bcc'},
 {name:'Broches',file:'Broches.pdf',expected:74,sha:'765f9986c2d5b1cc09ac49601828db02c04cb1996095f25f84c03098aa743a01'},
 {name:'Look Premium Verão',file:'Verao.pdf',expected:75,sha:'5726caa960773336114b1cc3315e44a7aaaea84a8b852a3c9070400a084abd09'},
]
process.env.PDF_OCR_ENGINE='paddle'
const health=await fetch('http://127.0.0.1:8088/health',{signal:AbortSignal.timeout(10000)})
if(!health.ok || (await health.json()).engine!=='paddleocr')throw Error('Real PaddleOCR unavailable. Benchmark aborted: never silently test Tesseract instead.')

await mkdir('artifacts/paddle-pdfs',{recursive:true})
const tests=[]
for(const item of benchmarks){
  const start=performance.now()
  const bytes=await readFile('pdf-fixtures/'+item.file)
  const hash=createHash('sha256').update(bytes).digest('hex')
  if(hash!==item.sha){console.error('MISMATCH_HASH',item.name,hash);tests.push({...item,status:'invalid_download',sha_actual:hash});continue}
  let ocrPages=0,fallbacks=0,photos=0,photoBytes=0,progress=0
  const originalInfo=console.info,originalWarn=console.warn
  try {
    console.info=(...args)=>{
      if(args[0]==='[pdf import]' && args.includes('via PaddleOCR'))ocrPages++
      else originalInfo(...args)
    }
    console.warn=(...args)=>{
      if(args[0]==='[pdf import]' && args[1]==='PaddleOCR unavailable on page')fallbacks++
      originalWarn(...args)
    }
    const extracted=await collectPdfCatalog(bytes,{
      onProgress: async ({pagesScanned})=>{progress=pagesScanned||progress},
      onImage: async (image,mime,filename)=>{
        photos++
        photoBytes+=image.length
        return 'test://'+item.name.replace(/[^A-Za-z0-9]/g,'-')+'/'+filename
      },
    })
    const products=extracted.candidates||[]
    const parsedPrice=products.filter(x=>Number.isFinite(Number(x.price))&&Number(x.price)>0).length
    const withImages=products.filter(x=>(x.images||[]).length>0).length
    const result={
      name:item.name,
      status:'parsed',
      expected:item.expected,
      found:products.length,
      priced:parsedPrice,
      withImages,
      photos,
      ocrPages,
      paddleFailures:fallbacks,
      pagesScanned:extracted.pagesScanned,
      durationSeconds:Math.round((performance.now()-start)/100)/10,
      priceData:products.map(p=>({
        page:p.pdf_page??null,
        item:p.pdf_item_number??null,
        title:String(p.title||'').slice(0,170),
        price:p.price??null,
        review:p.pdf_review_required??false,
        images:(p.images||[]).length,
      })),
    }
    tests.push(result)
    console.info('PDF_RESULT',JSON.stringify({...result,priceData:undefined}))
  }catch(e){
    const record={name:item.name,status:'error',expected:item.expected,error:String(e?.message||e).slice(0,500),
      ocrPages,paddleFailures:fallbacks,photos,progress,elapsedSeconds:Math.round((performance.now()-start)/100)/10}
    tests.push(record)
    console.error('PDF_RESULT',JSON.stringify(record))
  }finally{console.info=originalInfo;console.warn=originalWarn}
  await writeFile('artifacts/paddle-pdfs/'+item.file.replace('.pdf','.json'),
    JSON.stringify(tests.at(-1),null,2))
}
const summary={
  date:new Date().toISOString(),
  engine:'PP-OCRv6 Small CPU, genuine PaddleOCR process, no mock',
  sources:'Original 7 PDFs verified against SHA256 before scanning',
  totalExpected:benchmarks.reduce((t,x)=>t+x.expected,0),
  totalFound:tests.reduce((t,x)=>t+(x.found||0),0),
  totalOcrPages:tests.reduce((t,x)=>t+(x.ocrPages||0),0),
  totalPaddleFailures:tests.reduce((t,x)=>t+(x.paddleFailures||0),0),
  tests:tests.map(({priceData,...rest})=>rest),
}
await writeFile('artifacts/paddle-pdfs/summary.json',JSON.stringify(summary,null,2))
console.info('PDF_SUMMARY',JSON.stringify(summary))
