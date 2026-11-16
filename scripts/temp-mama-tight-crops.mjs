import sharp from 'sharp'
import {spawnSync} from 'node:child_process'
import {safeRequest} from '../server/scanner-collector.mjs'
import {googlePhotosImageUrls,googlePhotosHighResolutionUrl} from '../server/scanner-photo-albums.mjs'
import {parsePhotoProductLabel} from '../server/scanner-photo-ocr.mjs'
import {parseTesseractTsv} from '../server/scanner-pdf-tesseract.mjs'
import {links} from './mama-public-album-links.mjs'
const cases=[
 {album:3,photos:[32,33,51]},
 {album:4,photos:[21,39,76,120,132,140]},
]
const group=cases[Number(process.env.MAMA_TIGHT_GROUP)]
if(!group)throw Error('invalid group')
const [album,link]=links[group.album]
const page=await safeRequest(link,{accept:'text/html',maxBytes:24*1024*1024,timeout:18000})
const urls=googlePhotosImageUrls(page.body,10000)
const variants=[
 {name:'tight20psm6',width:.20,height:.14,output:2300,psm:6,type:'normalize'},
 {name:'tight25psm6sharp',width:.25,height:.17,output:2300,psm:6,type:'sharpen'},
 {name:'tight27psm11',width:.27,height:.17,output:1900,psm:11,type:'normalize'},
 {name:'tight30psm6thr',width:.30,height:.20,output:1800,psm:6,type:'threshold'},
 {name:'tight25psm3',width:.25,height:.16,output:2200,psm:3,type:'normalize'},
 {name:'tight35psm6grey',width:.35,height:.20,output:1900,psm:6,type:'sharpen'},
 {name:'tight25psm4',width:.25,height:.17,output:1900,psm:4,type:'threshold'},
]
for(const n of group.photos){
 try{
 const url=googlePhotosHighResolutionUrl(urls[n-1])||urls[n-1]
 const res=await safeRequest(url,{responseType:'buffer',accept:'image/*',maxBytes:8*1024*1024,timeout:18000})
 if(!res.ok)throw Error('download '+res.status)
 const meta=await sharp(res.buffer).metadata()
 const reads=[]
 for(const v of variants){
   let p=sharp(res.buffer).extract({
    left:0,top:0,width:Math.ceil(meta.width*v.width),height:Math.ceil(meta.height*v.height),
   }).resize({width:v.output}).grayscale()
   p=v.type==='threshold'?p.threshold(150):v.type==='sharpen'?p.normalize().sharpen():p.normalize()
   const bytes=await p.png().toBuffer()
   const run=spawnSync('prlimit',['--as=1073741824','--cpu=12','--fsize=10485760','--',
    'tesseract','stdin','stdout','-l','por+eng','--psm',String(v.psm),'tsv',
   ],{input:bytes,encoding:'utf8',timeout:13000,maxBuffer:512000})
   const output=parseTesseractTsv(run.stdout||'')
   reads.push({name:v.name,price:parsePhotoProductLabel(output.text).price,
     text:output.text.replace(/\n+/g,' / ').slice(0,190)})
 }
 console.log('MAMA_TIGHT_READ '+JSON.stringify({album,index:n,reads}))
 }catch(e){console.log('MAMA_TIGHT_READ '+JSON.stringify({album,index:n,error:String(e.message)}))}
}
