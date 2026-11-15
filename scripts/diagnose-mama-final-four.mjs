import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {recognizePhotoProductLabel,parsePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
import {parseTesseractTsv} from '../server/scanner-pdf-tesseract.mjs'
const samples=[
 ['Colares Aros','https://photos.app.goo.gl/q3bgsGmWQjVRBP8J9',[4]],
 ['Chokers','https://photos.app.goo.gl/4qNDWNyoEig83Dhn9',[3,8]],
 ['Inverno','https://photos.app.goo.gl/GmkVR55GHRgRmHP88',[7]],
]
const variants=[
 {name:'top25-psm3',x:0,y:0,w:.30,h:.16,psm:3,width:1600,style:'normalize'},
 {name:'top35-psm6',x:0,y:0,w:.35,h:.20,psm:6,width:1800,style:'normalize'},
 {name:'top45-psm11',x:0,y:0,w:.45,h:.25,psm:11,width:1700,style:'threshold'},
 {name:'top55-psm6',x:0,y:0,w:.55,h:.25,psm:6,width:1600,style:'sharpen'},
 {name:'bottomRight-psm3',x:.56,y:.64,w:.43,h:.30,psm:3,width:1600,style:'normalize'},
 {name:'bottomRight-psm6',x:.66,y:.73,w:.33,h:.25,psm:6,width:1600,style:'threshold'},
 {name:'bottomRight-psm11',x:.60,y:.70,w:.39,h:.27,psm:11,width:1600,style:'normalize'},
]
for(const [name,link,indices] of samples){
 const page=await safeRequest(link,{accept:'text/html',maxBytes:24*1024*1024,timeout:18000})
 const imgs=googlePhotosImageUrls(page.body,15)
 for(const pos of indices){
  const imgUrl=googlePhotosHighResolutionUrl(imgs[pos-1])||imgs[pos-1]
  const file=await safeRequest(imgUrl,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000})
  const meta=await sharp(file.buffer).metadata()
  const current=await recognizePhotoProductLabel(file.buffer)
  const reads=[]
  for(const v of variants){
    const left=Math.floor(meta.width*v.x),top=Math.floor(meta.height*v.y)
    let pipeline=sharp(file.buffer).extract({
      left,top,width:Math.min(meta.width-left,Math.ceil(meta.width*v.w)),
      height:Math.min(meta.height-top,Math.ceil(meta.height*v.h)),
    }).resize({width:v.width,kernel:'lanczos3'}).grayscale()
    if(v.style==='threshold')pipeline=pipeline.threshold(160)
    else if(v.style==='sharpen')pipeline=pipeline.normalize().sharpen()
    else pipeline=pipeline.normalize()
    const bytes=await pipeline.png().toBuffer()
    const run=spawnSync('prlimit',[
      '--as=1073741824','--cpu=12','--fsize=10485760','--',
      'tesseract','stdin','stdout','-l','por+eng','--psm',String(v.psm),'tsv',
    ],{input:bytes,timeout:15000,maxBuffer:800000,encoding:'utf8'})
    const output=parseTesseractTsv(run.stdout||'')
    const item=parsePhotoProductLabel(output.text)
    reads.push({name:v.name,result:item,text:output.text.slice(0,440),exit:run.status})
  }
  console.log('MAMA_FINAL_FOUR '+JSON.stringify({album:name,index:pos,dimensions:[meta.width,meta.height],current,reads}))
 }
}
