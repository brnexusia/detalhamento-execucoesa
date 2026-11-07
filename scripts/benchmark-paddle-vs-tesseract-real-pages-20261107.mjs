import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { paddleOcrLayout } from '../server/scanner-pdf-paddle.mjs'
import { associateOcrProducts } from '../server/scanner-pdf-spatial.mjs'

const pages=[
 {name:'Lume',file:'Lume.pdf',page:6,prices:['15,00','44,00','23,50','25,00']},
 {name:'Lume',file:'Lume.pdf',page:32,prices:['10,00','12,00'],ambiguous:['1300']},
 {name:'Lume',file:'Lume.pdf',page:46,prices:['14,00','39,00','27,50'],ambiguous:['12,0']},
 {name:'Costa',file:'Costa.pdf',page:5,prices:['18,00','32,50','34,50','28,50']},
 {name:'Costa',file:'Costa.pdf',page:37,prices:['7,00']},
 {name:'Origem',file:'Origem.pdf',page:5,prices:['17,50','37,50','27,00']},
 {name:'Memories',file:'Memories.pdf',page:5,prices:['17,00','36,00','27,00','24,00','51,00']},
 {name:'Memories Drop II',file:'MemoriesDropII.pdf',page:4,prices:['23,00','45,00','24,00']},
 {name:'Memories Drop II',file:'MemoriesDropII.pdf',page:20,prices:['12,50','43,50','36,00']},
 {name:'Broches',file:'Broches.pdf',page:2,prices:['10,00']},
 {name:'Broches',file:'Broches.pdf',page:3,prices:['7,50']},
]
function cents(raw){
  const x=String(raw).replace(/\./g,'').replace(',','.')
  const n=Number(x)
  return Number.isFinite(n)?Math.round(n*100):null
}
function values(text){
  const observed=new Set()
  const re=/(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{1,6})[,.](\d{2})(?!\d)/g
  for(const x of String(text||'').matchAll(re)){
    const n=Number(x[1].replace(/\./g,'')+'.'+x[2])
    if(Number.isFinite(n)&&n>0)observed.add(Math.round(n*100))
  }
  return observed
}
await mkdir('artifacts/paddle-pdfs',{recursive:true})
const dir=await mkdtemp(path.join(os.tmpdir(),'paddle-vs-tess-'))
const rows=[]
try{
 for(const fixture of pages){
  const prefix=path.join(dir,'page')
  const rendered=spawnSync('pdftoppm',[
    '-f',String(fixture.page),'-l',String(fixture.page),'-scale-to','1600',
    '-singlefile','-gray','-png','pdf-fixtures/'+fixture.file,prefix,
  ],{timeout:30000})
  if(rendered.status!==0){
    const row={name:fixture.name,page:fixture.page,status:'render_failed',error:String(rendered.stderr).slice(0,200)}
    rows.push(row);console.info('OCR_PAGE',JSON.stringify(row));continue
  }
  const image=await readFile(prefix+'.png')
  const metrics={name:fixture.name,page:fixture.page,imageBytes:image.length,expected:fixture.prices,ambiguous:fixture.ambiguous||[]}
  let paddleText='',tessText=''
  const pstart=performance.now()
  try{
    const result=await paddleOcrLayout(image,{deadline:Date.now()+60000})
    paddleText=result.text
    const assoc=associateOcrProducts(result,fixture.page)
    metrics.paddle_spatial_products=assoc.length
    metrics.paddle_lines=result.lines.length
    metrics.paddle_ms=Math.round(performance.now()-pstart)
  }catch(e){
    metrics.paddle_error=String(e?.message||e).slice(0,300)
    metrics.paddle_ms=Math.round(performance.now()-pstart)
  }
  const tstart=performance.now()
  const tess=spawnSync('tesseract',[prefix+'.png','stdout','-l','por+eng'],{timeout:20000})
  tessText=tess.status===0?String(tess.stdout||''):''
  metrics.tesseract_ms=Math.round(performance.now()-tstart)
  if(tess.status!==0)metrics.tesseract_error=String(tess.stderr||'').slice(0,220)
  const expected=[...new Set(fixture.prices.map(cents))]
  const pvalues=values(paddleText),tvalues=values(tessText)
  metrics.paddle_detected=expected.filter(v=>pvalues.has(v)).length
  metrics.tesseract_detected=expected.filter(v=>tvalues.has(v)).length
  metrics.expected_unique=expected.length
  metrics.paddle_text_sample=paddleText.replace(/\s+/g,' ').slice(0,450)
  metrics.tesseract_text_sample=tessText.replace(/\s+/g,' ').slice(0,450)
  rows.push(metrics)
  console.info('OCR_PAGE',JSON.stringify(metrics))
  await rm(prefix+'.png',{force:true})
 }
}finally{await rm(dir,{recursive:true,force:true})}
const summary={
 engine_paddle:'PP-OCRv6 Small running on CPU, actual Docker service',
 engine_baseline:'Tesseract por+eng installed in same Docker',
 rendered_pages:rows.length,
 expected_prices:rows.reduce((s,x)=>s+(x.expected_unique||0),0),
 paddle_detected:rows.reduce((s,x)=>s+(x.paddle_detected||0),0),
 tesseract_detected:rows.reduce((s,x)=>s+(x.tesseract_detected||0),0),
 paddle_ms:rows.reduce((s,x)=>s+(x.paddle_ms||0),0),
 tesseract_ms:rows.reduce((s,x)=>s+(x.tesseract_ms||0),0),
 rows,
}
console.info('OCR_COMPARE_SUMMARY',JSON.stringify({...summary,rows:undefined}))
await writeFile('artifacts/paddle-pdfs/forced-ocr-comparison.json',JSON.stringify(summary,null,2))
