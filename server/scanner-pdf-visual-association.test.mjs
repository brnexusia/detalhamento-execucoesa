import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTesseractTsv } from './scanner-pdf-tesseract.mjs'
import {
  parsePdfVisualGeometry,numberedPhotoRegions,
  associateNativePricesByProximity,proximityPhotoRegions,
} from './scanner-pdf-visual-association.mjs'

const word=(text,x,y,w=70,h=24)=>'<word xMin="'+x+'" yMin="'+y+'" xMax="'+(x+w)+'" yMax="'+(y+h)+'">'+text+'</word>'
const line=(...words)=>'<line>'+words.join('')+'</line>'
const page=(...lines)=>'<page width="810" height="1440">'+lines.join('')+'</page>'

test('Tesseract TSV yields trustworthy line boxes without PaddleOCR',()=>{
 const raw=[
 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
 '5\t1\t1\t1\t1\t1\t10\t20\t120\t30\t95\tVestido',
 '5\t1\t1\t1\t1\t2\t135\t20\t100\t30\t90\tAurora',
 '5\t1\t1\t1\t2\t1\t12\t65\t22\t30\t92\tR$',
 '5\t1\t1\t1\t2\t2\t35\t65\t100\t30\t91\t12,50',
 '5\t1\t1\t1\t3\t1\t20\t100\t20\t20\t12\truído',
 ].join('\n')
 const result=parseTesseractTsv(raw)
 assert.equal(result.lines.length,2)
 assert.equal(result.lines[0].text,'Vestido Aurora')
 assert.deepEqual(result.lines[0].box,[10,20,235,50])
 assert.equal(result.lines[1].text,'R$ 12,50')
 assert.equal(result.lines[1].score>.9,true)
})

test('numbered image badges match EXACT price-page item ids, never another look',()=>{
 const geometry=parsePdfVisualGeometry(
 page(line(word('1',400,170,25)),line(word('2',180,620,25)),
   line(word('01',70,1330,35),word('R$',110,1330,30),word('15,00',145,1330)),
   line(word('02',70,1370,35),word('R$',110,1370,30),word('44,00',145,1370)))+
 page(line(word('1',550,300,25)),line(word('01',70,1330,35),word('R$',110,1330,30),word('19,00',145,1330))))
 const items=[
 {pdf_lookbook:true,pdf_page:1,pdf_item_number:1,images:[],price:15},
 {pdf_lookbook:true,pdf_page:1,pdf_item_number:2,images:[],price:44},
 {pdf_lookbook:true,pdf_page:2,pdf_item_number:1,images:[],price:19},
 ]
 const found=numberedPhotoRegions(items,geometry)
 assert.equal(found.length,3)
 assert.deepEqual(found.map(x=>[x.page,x.candidate.pdf_item_number]),[[1,1],[1,2],[2,1]])
 assert.ok(found.every(x=>x.method==='number_marker'&&x.confidence==='review'))
 assert.ok(found.every(x=>x.rect.bottom<x.rect.height*.89))
})

test('duplicate marker on same page is ambiguous; never crop or invent match',()=>{
 const g=parsePdfVisualGeometry(page(line(word('1',400,170)),line(word('1',430,260)),
   line(word('2',200,320))))
 const candidates=[1,2].map(id=>({pdf_lookbook:true,pdf_page:1,pdf_item_number:id,images:[]}))
 const got=numberedPhotoRegions(candidates,g)
 assert.equal(got.length,1)
 assert.equal(got[0].candidate.pdf_item_number,2)
})

test('match right-column price to right-column product regardless of reading order',()=>{
 const g=parsePdfVisualGeometry(page(
  line(word('Vestido',50,550,130),word('Azul',190,550,65)),
  line(word('Blusa',495,550,105),word('Rosa',610,550,65)),
  line(word('R$',490,600,45),word('79,90',540,600,95)),
  line(word('R$',55,600,45),word('29,90',105,600,95)),
 ))
 const items=[
  {title:'Vestido Azul',pdf_page:1,price:79.9,description:'',images:[]},
  {title:'Blusa Rosa',pdf_page:1,price:29.9,description:'',images:[]},
 ]
 const found=associateNativePricesByProximity(items,g)
 assert.equal(found.length,2)
 assert.deepEqual(items.map(x=>x.price),[29.9,79.9])
 assert.ok(items.every(x=>x.pdf_review_required===true&&x.pdf_price_association==='same_page_proximity'))
 assert.match(items[0].description,/preço anterior 79.9 alterado para 29.9/)
})

test('two photo columns above matched titles yield separate review crops',()=>{
 const g=parsePdfVisualGeometry(page(
   line(word('Vestido',50,650,130),word('Azul',190,650,65)),
   line(word('Blusa',495,660,105),word('Rosa',610,660,65)),
   line(word('R$',490,700,45),word('79,90',540,700,95)),
   line(word('R$',55,700,45),word('29,90',105,700,95)),
 ))
 const items=[
  {title:'Vestido Azul',pdf_page:1,price:29.9,images:[],description:''},
  {title:'Blusa Rosa',pdf_page:1,price:79.9,images:[],description:''},
 ]
 const matches=associateNativePricesByProximity(items,g)
 const photos=proximityPhotoRegions(matches,g,new Map([[1,[{kind:'image',width:500,height:500}]]]))
 assert.equal(photos.length,2)
 assert.ok(photos[0].rect.right<=photos[1].rect.left)
 assert.ok(photos.every(x=>x.confidence==='review'&&x.rect.bottom<x.rect.height))
})

test('never re-price crowded price lists without unique positional evidence',()=>{
 const geometry=parsePdfVisualGeometry(page(
  line(word('Vestido',50,140,130),word('Azul',190,140,65)),
  line(word('Blusa',50,160,100),word('Rosa',160,160,65)),
  line(word('R$',50,740,30),word('12,50',85,740,80)),
  line(word('R$',50,775,30),word('18,00',85,775,80)),
 ))
 const items=[
  {title:'Vestido Azul',pdf_page:1,price:12.5,images:[]},
  {title:'Blusa Rosa',pdf_page:1,price:18,images:[]},
 ]
 assert.deepEqual(associateNativePricesByProximity(items,geometry),[])
 assert.deepEqual(items.map(x=>x.price),[12.5,18])
})
