// Coordinates from Poppler's pdftotext -bbox-layout, never from guessed reading order.
// These heuristics are review-only. Numbered references always take precedence over distance.
const normalize = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const attr = (s, key) => Number(new RegExp('\\b' + key + '="([0-9.]+)"').exec(s)?.[1])
const unescapeXml = (raw) => String(raw || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(Number(d)))
const isBox = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2]>b[0] && b[3]>b[1]

export function parsePdfVisualGeometry(xml, maxPages = 200) {
  const byPage = new Map()
  const rawPages = [...String(xml || '').matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gi)].slice(0,maxPages)
  for(let index=0; index<rawPages.length; index++){
    const head=rawPages[index][1], body=rawPages[index][2]
    const width=attr(head,'width'), height=attr(head,'height')
    if(!(width>0&&height>0&&width<50000&&height<50000))continue
    const words=[],lines=[]
    for(const m of body.matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/gi)){
      const inLine=[]
      for(const v of m[1].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/gi)){
        const w=v[1], text=unescapeXml(v[2]).replace(/\s+/g,' ').trim()
        const b=[attr(w,'xMin'),attr(w,'yMin'),attr(w,'xMax'),attr(w,'yMax')]
        if(!text||!isBox(b)||b[0]<0||b[1]<0||b[2]>width+10||b[3]>height+10)continue
        const word={text,box:b,cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2}
        inLine.push(word)
        if(words.length<10000)words.push(word)
      }
      if(!inLine.length)continue
      const b=[
        Math.min(...inLine.map(w=>w.box[0])),
        Math.min(...inLine.map(w=>w.box[1])),
        Math.max(...inLine.map(w=>w.box[2])),
        Math.max(...inLine.map(w=>w.box[3])),
      ]
      lines.push({text:inLine.map(w=>w.text).join(' '),box:b,words:inLine,cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2})
    }
    byPage.set(index+1,{page:index+1,width,height,words,lines})
  }
  return byPage
}
function numberOnWord(raw){
  if(!/^(?:0?[1-9]|[1-9][0-9])$/.test(String(raw||'').trim()))return null
  const n=Number(raw)
  return n>0&&n<=99?n:null
}
function rectAroundMarker(marker, layout, siblings) {
  const {width:w,height:h}=layout
  let rx=Math.min(w*.19,210),ry=Math.min(h*.15,230)
  // When a supplier labels multiple small objects in one model photo,
  // keep the crop near its own marker instead of embracing the next label.
  for(const other of siblings){
    if(other===marker)continue
    const dx=Math.abs(other.cx-marker.cx),dy=Math.abs(other.cy-marker.cy)
    if(dy<h*.13 && dx<w*.4)rx=Math.min(rx,Math.max(52,dx*.48))
    if(dx<w*.17 && dy<h*.32)ry=Math.min(ry,Math.max(65,dy*.48))
  }
  const x0=Math.max(0,marker.cx-rx),x1=Math.min(w,marker.cx+rx)
  const y0=Math.max(0,marker.cy-ry),y1=Math.min(h*.88,marker.cy+ry)
  if(x1-x0<70||y1-y0<95)return null
  return {left:x0,top:y0,right:x1,bottom:y1,width:w,height:h}
}

/**
 * Same-page printed product number -> reference -> price item from lookbook.
 * Never join repeated 01/02 across price pages / looks; use exact page + ID.
 */
export function numberedPhotoRegions(candidates, layoutPages, imagePages = null) {
  const groups=new Map()
  for(const c of candidates){
    if(!(c.pdf_lookbook||c.pdf_numbered_reference) || c.images?.length ||
      !Number.isInteger(c.pdf_item_number) || !Number.isInteger(c.pdf_page))continue
    const photoPage=c.pdf_photo_marker_page||c.pdf_page
    const items=groups.get(photoPage)||[]
    items.push(c); groups.set(photoPage,items)
  }
  const matches=[]
  for(const [page,items] of groups){
    const layout=layoutPages.get(page)
    if(!layout)continue
    const images=imagePages?.get(page)||[]
    if(imagePages && !images.some(x=>x.kind==='image'&&x.width>=220&&x.height>=220))continue
    const ids=new Set(items.map(x=>x.pdf_item_number))
    // Some numbered bracelets sit immediately above the printed price footer.
    // Instead of dropping all lower-page badges, exclude the ACTUAL R$ table
    // rows by their Y coordinate. This prevents price row "04" being a marker.
    const priceRowY=layout.lines.filter(line=>/(?:R\s*\$|BRL)/i.test(line.text))
      .map(line=>line.cy)
    const markers=layout.words.filter(word=>
      word.cy<layout.height*.90 && word.cy>layout.height*.035 &&
      ids.has(numberOnWord(word.text)) &&
      priceRowY.every(y=>Math.abs(word.cy-y)>Math.max(12,layout.height*.012)))
    const counts=new Map()
    for(const mark of markers){
      const n=numberOnWord(mark.text)
      counts.set(n,(counts.get(n)||0)+1)
    }
    const distinct=[...counts].filter(([,n])=>n===1).map(([id])=>id)
    // A full look can contain multiple labels; reject pages where a stray
    // decorative number cannot be distinguished from a product marker.
    if(distinct.length < (items.length===1?1:2))continue
    for(const c of items){
      if(counts.get(c.pdf_item_number)!==1)continue
      const mark=markers.find(x=>numberOnWord(x.text)===c.pdf_item_number)
      const rect=rectAroundMarker(mark,layout,markers)
      if(rect)matches.push({candidate:c,page,rect,method:'number_marker',confidence:'review'})
    }
  }
  return matches
}

const PRICE = /(?:R\s*\$|BRL)\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}\.\d{2})(?![\d,.])/gi
const BAD = /^\s*(?:total|subtotal|frete|desconto|pedido minimo|pedido mínimo)\b/i
function priceRows(layout){
  return layout.lines.flatMap(line=>{
    if(BAD.test(line.text))return []
    const prices=[...line.text.matchAll(PRICE)]
    if(prices.length!==1)return []
    const v=prices[0][1].includes(',')?Number(prices[0][1].replace(/\./g,'').replace(',','.')):Number(prices[0][1])
    if(!(v>0&&v<=1e6))return []
    const amount=prices[0][1]
    const last=line.words.find(w=>w.text.replace(/\s/g,'').includes(amount))
    const b=last?.box||line.box
    return [{price:v,box:b,cx:(b[0]+b[2])/2,cy:(b[1]+b[3])/2,line}]
  })
}
function anchorsFor(items,layout){
  const used=new Set()
  const out=[]
  for(const candidate of items){
    const name=normalize(candidate.title).replace(/\bpara identificar\b/g,'').trim()
    if(name.length<6||/^acessorio\b/.test(name)||/^peca para identificar/.test(name))return []
    const matches=layout.lines.filter(line=>{
      const txt=normalize(line.text)
      return txt.includes(name) && name.length>=txt.length*.35
    })
    if(matches.length!==1||used.has(matches[0]))return []
    used.add(matches[0])
    out.push({candidate,line:matches[0],box:matches[0].box,
      cx:matches[0].cx,cy:matches[0].cy})
  }
  return out
}
function proximityCost(a,p,layout){
  const dx=Math.abs(a.cx-p.cx)/layout.width,dy=Math.abs(a.cy-p.cy)/layout.height
  const horizontalOverlap=Math.min(a.box[2],p.box[2])-Math.max(a.box[0],p.box[0])
  // The next price may appear beside or below a name; never jump columns.
  if(dx>.24 || dy>.27 || (horizontalOverlap<0&&dx>.18))return Infinity
  return dx*2.2+dy*1.5
}
/**
 * Only adjust multi-product native-text pages when ALL product names have
 * unique positioned text boxes, ALL prices can be paired one-to-one,
 * and the geometric winner has no close competing price/name.
 */
export function associateNativePricesByProximity(candidates, layouts) {
  const byPage=new Map()
  for(const candidate of candidates){
    if(candidate.pdf_lookbook||candidate.pdf_fashion_lookbook)continue
    const list=byPage.get(candidate.pdf_page)||[]
    list.push(candidate);byPage.set(candidate.pdf_page,list)
  }
  const matched=[]
  for(const [page,items] of byPage){
    const layout=layouts.get(page)
    if(!layout||items.length<2||items.length>10)continue
    const titles=anchorsFor(items,layout)
    const prices=priceRows(layout)
    if(titles.length!==items.length||prices.length!==items.length)continue
    const edges=titles.flatMap((a,ai)=>prices.map((p,pi)=>({ai,pi,cost:proximityCost(a,p,layout)})))
      .filter(x=>Number.isFinite(x.cost)).sort((x,y)=>x.cost-y.cost)
    if(edges.length<items.length)continue
    const usedA=new Set(),usedP=new Set(),chosen=[]
    for(const edge of edges){
      if(usedA.has(edge.ai)||usedP.has(edge.pi))continue
      const otherP=edges.filter(x=>x.ai===edge.ai&&x.pi!==edge.pi&&x.cost<=edge.cost+.07)
      const otherA=edges.filter(x=>x.pi===edge.pi&&x.ai!==edge.ai&&x.cost<=edge.cost+.07)
      if(otherP.length||otherA.length)continue
      usedA.add(edge.ai);usedP.add(edge.pi);chosen.push(edge)
    }
    if(chosen.length!==items.length)continue
    for(const {ai,pi} of chosen){
      const a=titles[ai],p=prices[pi],item=a.candidate
      const previous=item.price
      if(previous!=null && Math.abs(Number(previous)-p.price)>.001){
        item.pdf_review_required=true
        item.description=[String(item.description||''), 'REVISÃO OBRIGATÓRIA: preço anterior '+previous+' alterado para '+p.price+' por proximidade 2D na página '+page+'.'].join(' ').trim()
        item.price=p.price
        item.price_text='R$ '+p.price.toFixed(2).replace('.',',')
      }else if(previous==null) {
        item.pdf_review_required=true
        item.price=p.price
        item.price_text='R$ '+p.price.toFixed(2).replace('.',',')
      }
      item.pdf_price_association='same_page_proximity'
      matched.push({candidate:item,page,anchor:a.line,price:p,method:'same_page_proximity',confidence:'review'})
    }
  }
  return matched
}
/**
 * When distinct products share a photographed page, crop only the image
 * region directly ABOVE each anchored title, within its local column.
 * This is a suggestion for review, not a guaranteed isolated product photo.
 */
export function proximityPhotoRegions(matched, layouts, imagePages){
  const byPage=new Map()
  for(const pair of matched){
    if(pair.candidate.images?.length)continue
    const list=byPage.get(pair.page)||[]
    list.push(pair);byPage.set(pair.page,list)
  }
  const results=[]
  for(const [page,pairs] of byPage){
    if(pairs.length<2)continue
    const layout=layouts.get(page)
    const images=imagePages.get(page)||[]
    if(!layout || !images.some(x=>x.kind==='image'&&x.width>=220&&x.height>=220))continue
    for(const pair of pairs){
      const {width:w,height:h}=layout
      const anchor=pair.anchor
      const before=pairs.filter(x=>x!==pair&&x.anchor.cy<anchor.cy-h*.1&&
        Math.abs(x.anchor.cx-anchor.cx)<w*.18).sort((a,b)=>b.anchor.cy-a.anchor.cy)[0]
      let left=0,right=w
      for(const other of pairs){
        if(other===pair||Math.abs(other.anchor.cy-anchor.cy)>h*.12)continue
        const midpoint=(anchor.cx+other.anchor.cx)/2
        if(other.anchor.cx<anchor.cx)left=Math.max(left,midpoint)
        else right=Math.min(right,midpoint)
      }
      left=Math.max(left,anchor.cx-w*.26);right=Math.min(right,anchor.cx+w*.26)
      const top=Math.max(h*.025,before?before.anchor.box[3]+h*.01:anchor.box[1]-h*.40)
      const bottom=anchor.box[1]-h*.015
      if(right-left < w*.17 || bottom-top<h*.16)continue
      results.push({candidate:pair.candidate,page,
        rect:{left,top,right,bottom,width:w,height:h},
        method:'above_label_proximity',confidence:'review'})
    }
  }
  return results
}


// Generic catalog layout where photos printed with item numbers occur on
// one page and a separate price list occurs on a neighboring page.
// Never activate if the primary supplier/parser already identified products.
const NUMBERED_PRICE = /\b(0?[1-9]|[1-9][0-9])\s*[:.\-]?\s*R\s*\$\s*(\d{1,6}(?:\.\d{3})*,\d{2})(?![\d,])/gi
function numberedPriceTable(raw) {
  const table=new Map(),bad=new Set()
  for(const row of String(raw||'').matchAll(NUMBERED_PRICE)){
    const id=Number(row[1]),price=Number(row[2].replace(/\./g,'').replace(',','.'))
    if(!(price>0&&price<=1e6))continue
    if(table.has(id) && table.get(id)!==price)bad.add(id)
    else table.set(id,price)
  }
  for(const id of bad)table.delete(id)
  return table.size>=2?table:null
}
function photoBadgeIds(layout) {
  if(!layout)return new Set()
  const footerYs=layout.lines.filter(line=>/(?:R\s*\$|BRL)/i.test(line.text)).map(line=>line.cy)
  const counts=new Map()
  for(const word of layout.words) {
    const id=numberOnWord(word.text)
    if(!id || word.cy>layout.height*.90 || word.cy<layout.height*.035 ||
      footerYs.some(y=>Math.abs(word.cy-y)<=Math.max(12,layout.height*.012)))continue
    counts.set(id,(counts.get(id)||0)+1)
  }
  return new Set([...counts].filter(([,count])=>count===1).map(([id])=>id))
}
/**
 * Build strictly evidenced candidates from a detached numbered price table:
 *  01 R$ 12,50  ↔  isolated photo badge "1" on a nearby visual page.
 * Require at least two corroborating numbers, unique top ranked page, and a
 * single use of the photo page. All resulting items require human approval.
 */
export function parseNumberedReferenceFallback(rawPages,layoutPages,maxProducts=500) {
  const pages=Array.isArray(rawPages)?rawPages:String(rawPages||'').split('\f')
  const pricePages=[]
  for(let i=0;i<pages.length;i++) {
    const table=numberedPriceTable(pages[i])
    if(table)pricePages.push({page:i+1,table})
  }
  if(!pricePages.length)return []
  const usedPhotoPages=new Set(),out=[]
  for(const entry of pricePages) {
    if(out.length>=maxProducts)break
    const options=[]
    for(let page=Math.max(1,entry.page-3);page<=Math.min(pages.length,entry.page+3);page++){
      const layout=layoutPages.get(page)
      if(!layout)continue
      const markers=photoBadgeIds(layout)
      const matching=[...entry.table.keys()].filter(id=>markers.has(id))
      if(matching.length<2)continue
      const distance=Math.abs(page-entry.page)
      // Supplier photo pages usually come before the item/price legend.
      const score=matching.length*10-distance-(page>entry.page?.7:0)
      options.push({page,matching,score})
    }
    options.sort((a,b)=>b.score-a.score || a.page-b.page)
    const winner=options.find(x=>!usedPhotoPages.has(x.page))
    const competitor=options.find(x=>x!==winner&&!usedPhotoPages.has(x.page))
    if(!winner || (competitor && competitor.score>=winner.score-.2))continue
    usedPhotoPages.add(winner.page)
    for(const [id,price] of entry.table){
      if(out.length>=maxProducts)break
      // Never manufacture a product when the corresponding photo number is absent.
      if(!winner.matching.includes(id))continue
      const item=String(id).padStart(2,'0')
      const description='Referência '+item+' da tabela na página '+entry.page+
        '; número marcado na fotografia da página '+winner.page+
        '. REVISÃO OBRIGATÓRIA: confirmar o produto e o recorte.'
      out.push({
        title:'Produto numerado · página '+winner.page+' · ref. '+item,
        description,sku:'',category:'Geral',price,price_text:'R$ '+price.toFixed(2).replace('.',','),
        currency:'BRL',images:[],properties:[],variants:[],source:'pdf',
        source_url:'pdf://page/'+entry.page+'/reference/'+item,
        external_id:'pdf-numbered-p'+entry.page+'-r'+item,
        pdf_page:entry.page,pdf_photo_marker_page:winner.page,
        pdf_item_number:id,pdf_numbered_reference:true,pdf_review_required:true,
      })
    }
  }
  return out
}
