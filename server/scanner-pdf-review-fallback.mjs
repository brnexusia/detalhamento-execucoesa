// When a PDF has named, referenced items but no machine-readable prices,
// preserve only explicitly identified products for MANUAL price review.
const PRODUCT_WORD = /\b(?:vestido|blusa|camisa|camiseta|calça|calca|saia|shorts?|bermuda|conjunto|jaqueta|casaco|cropped|macac[aã]o|body|top|legging|biqu[ií]ni|mai[oô]|bolsa|brinco|colar|pulseira|anel|bracelete|corrente|lenço|lenco|chap[eé]u|bon[eé]|pare[oô]|sand[aá]lia|sapato|t[eê]nis)\b/i
const REFERENCE = /\b(?:ref(?:er[eê]ncia)?|sku|c[oó]d(?:igo)?|modelo)\s*[:#.-]?\s*([A-Za-z0-9][A-Za-z0-9.-]{1,40})\b/i
const NON_PRODUCT = /^(?:cat[aá]logo|sum[aá]rio|cole[cç][aã]o|whatsapp|instagram|contato|tabela|pre[cç]os|ref(?:er[eê]ncia)?|sku|c[oó]d(?:igo)?|modelo)\b/i

export function parseReferenceOnlyPdfProducts(rawPages, maxProducts=500) {
  const candidates=[]
  const pages=Array.isArray(rawPages)?rawPages:[]
  for(let page=0;page<pages.length;page++){
    const lines=String(pages[page]||'').replace(/\r/g,'').split('\n').map(x=>x.trim().replace(/\s+/g,' ')).filter(Boolean)
    for(let i=1;i<lines.length && candidates.length<maxProducts;i++){
      const match=REFERENCE.exec(lines[i])
      if(!match)continue
      const reference=match[1]
      if(!/[0-9]/.test(reference) || reference.length<2)continue
      // The name must actually be written next to a product reference; never
      // invent titles from generic catalog headings or photo-only pages.
      const name=lines[i-1].replace(/\s*[-:]\s*$/,'').trim()
      if(!PRODUCT_WORD.test(name) || NON_PRODUCT.test(name) || name.length<5 || name.length>180)continue
      const source='pdf://page/'+(page+1)+'/referenced/'+encodeURIComponent(reference)
      candidates.push({
        title:name,sku:reference,price:null,currency:'BRL',category:'',
        description:'Preço não legível na origem. REVISÃO OBRIGATÓRIA antes de publicar.',
        source:'pdf',source_url:source,external_id:'pdf-ref-p'+(page+1)+'-'+reference,
        pdf_page:page+1,images:[],variants:[],properties:[],
      })
    }
  }
  return candidates
}
