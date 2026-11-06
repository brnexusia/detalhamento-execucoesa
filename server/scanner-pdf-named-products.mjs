// Only explicit, standalone product titles with quantity/pack-size are
// recovered from price-free catalogs; no guessing from descriptive paragraphs.
const PRODUCT = /^(?:shampoo|condicionador|m[aá]scara|creme(?:\s+de\s+pentear)?|[oó]leo|s[eé]rum|t[oô]nico|b[aá]lsamo|elixir|ativador|polivitam[ií]nico|spray|perfume|hidratante|sabonete|lo[cç][aã]o|protetor|pomada|leave[- ]?in|gel|fluido|ampola|reconstrutor|descolorante|colora[cç][aã]o)\b/i
const PACK = /\b\d+(?:[.,]\d+)?\s*(?:ml|l|kg|g|unidades?|und|pcs|pe[cç]as?)\b/i
const STOP = /^(?:contato|endere[cç]o|@|www\.|https?:|promo[cç][aã]o|tabela|pre[cç]o|desde|indicado|oferece|reduz|desenvolvido|com|para|cont[eé]m|fornece|possui|linha|cole[cç][aã]o|kit do dia)\b/i
function clean(value) { return String(value||'').replace(/\s+/g,' ').trim() }
export function parseNamedUnpricedPdfProducts(pages,maxProducts=500) {
  const found=[]
  const seen=new Set()
  for(let i=0;i<(pages||[]).length;i++){
    for(const line of String(pages[i]||'').replace(/\r/g,'').split('\n')) {
      const title=clean(line)
      if(title.length<9||title.length>150||STOP.test(title)||!PRODUCT.test(title)||!PACK.test(title))continue
      // Prevent paragraphs that happen to mention both a product and a volume.
      if(/[.!?]/.test(title)||title.split(' ').length>14)continue
      const key=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      if(seen.has(key))continue
      seen.add(key)
      found.push({
        title,sku:'',price:null,price_text:'',currency:'BRL',category:'',
        description:'Preço ausente no catálogo. Preenchimento e revisão obrigatórios antes da publicação.',
        external_id:'pdf-unpriced-p'+(i+1)+'-i'+(found.length+1),
        source_url:'pdf://page/'+(i+1)+'/unpriced/'+(found.length+1),
        source:'pdf',pdf_page:i+1,images:[],variants:[],properties:[],
        pdf_review_required:true,
      })
      if(found.length>=maxProducts)return found
    }
  }
  return found
}
