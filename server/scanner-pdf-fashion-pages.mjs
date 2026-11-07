// Generic one-labelled-fashion-product-per-page layout, common in Canva
// photo lookbooks. Price often precedes title in the PDF text layer and all
// words are duplicated, so a nearest-line price parser links wrong products.
// Do not trigger based on merchant identity; require layout evidence.
const PRODUCT_TYPE='Calça|Blusa|Vestido|Conjunto|Shorts?|Saia|Cropped|Top|Macac[aã]o|Regata|Regta|Camisa|Body|Corset|Colete|Bermuda|Kimono|Jaqueta'
const PRODUCT_LINE=new RegExp('^('+PRODUCT_TYPE+')\\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .\\-/]{1,90})$','i')
const TYPE_START=new RegExp('(?:'+PRODUCT_TYPE+')\\s+','gi')
const PRICE=/R\$\s*(\d{1,6}(?:\.\d{3})*,\d{2})(?!\d)/g
const clean=(s)=>String(s||'').replace(/\s+/g,' ').trim()
const key=(s)=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
function undoDoubled(line) {
  const str=clean(line)
  if (str.length%2===0 && str.slice(0,str.length/2)===str.slice(str.length/2))
    return str.slice(0,str.length/2).trim()
  // In Canva exports text may have no separator: "Calça OliviaCalça Olivia".
  TYPE_START.lastIndex=0
  const positions=[...str.matchAll(TYPE_START)].map(m=>m.index).filter(n=>n!=null)
  if(positions.length===2 && positions[0]===0 && str.slice(0,positions[1])===str.slice(positions[1]))
    return str.slice(0,positions[1]).trim()
  return str
}
function parsePage(pageText,page) {
  const lines=String(pageText||'').split(/\r?\n/).map(undoDoubled).filter(Boolean)
  const titles=[...new Map(lines.map(line=>[key(line),line])
    .filter(([,line])=>PRODUCT_LINE.test(line))).values()]
  const prices=[...new Set([...String(pageText||'').matchAll(PRICE)]
    .map(match=>Number(match[1].replace(/\./g,'').replace(',','.')))
    .filter(n=>n>0 && n<=1e6))]
  if(!prices.length)return null
  const fabric=lines.find(x=>/^tecido\s*:/i.test(x))?.replace(/^tecido\s*:\s*/i,'')||''
  const size=lines.find(x=>/^tam(?:anho)?\s*:/i.test(x))?.replace(/^tam(?:anho)?\s*:\s*/i,'')||''
  return {page,titles,prices,fabric:clean(fabric),size:clean(size),
    hasValor:/\bValor\s*:\s*R\$/i.test(pageText)}
}
export function parseFashionPhotoPages(pages,maxProducts=500) {
  const entries=[]
  for(let i=0;i<pages.length;i++){
    const entry=parsePage(pages[i],i+1)
    if(entry)entries.push(entry)
  }
  const usable=entries.filter(p=>p.titles.length===1&&p.prices.length===1&&p.hasValor)
  // Require multiple independently numbered pages so isolated product pages
  // in an ordinary multi-product catalog do not hijack the normal extractor.
  if(entries.length<4 || usable.length<4 || usable.length/entries.length<.7)return null
  const limited=entries.slice(0,maxProducts)
  const freq=new Map()
  for(const p of limited) if(p.titles.length===1 && p.prices.length===1) {
    const k=key(p.titles[0])+'|'+p.prices[0]+'|'+key(p.fabric)
    freq.set(k,(freq.get(k)||0)+1)
  }
  const candidates=limited.map(p=>{
    const title=p.titles.length===1?p.titles[0]:'Peça para identificar (página '+p.page+')'
    const price=p.prices.length===1?p.prices[0]:null
    const duplicate=(freq.get(key(title)+'|'+price+'|'+key(p.fabric))||0)>1
    const review=p.titles.length!==1||p.prices.length!==1||duplicate
    const notes=['Página '+p.page+'.']
    if(p.fabric)notes.push('Tecido: '+p.fabric+'.')
    if(p.size)notes.push('Tamanho: '+p.size+'.')
    if(duplicate)notes.push('MESMO MODELO EM OUTRAS PÁGINAS: reúna fotos e variações antes de publicar.')
    if(review && !duplicate)notes.push('REVISÃO OBRIGATÓRIA: nome ou preço ambíguo.')
    return {
      title,sku:'',price,price_text:price===null?'':String(price),
      currency:'BRL',description:notes.join(' '),category:'',
      images:[],properties:[],variants:[],source:'pdf',
      source_url:'pdf://page/'+p.page+'/fashion/0',
      external_id:'pdf-fashion-p'+p.page,pdf_page:p.page,
      pdf_fashion_lookbook:true,pdf_review_required:review,
      pdf_duplicate_model:duplicate,
    }
  })
  return {candidates,pagesScanned:pages.filter(p=>String(p||'').trim()).length,
    fashion:true,unlabeledPhotoPages:pages.filter(p=>!String(p||'').trim()).length,
    duplicatesReview:candidates.filter(p=>p.pdf_duplicate_model).length}
}
