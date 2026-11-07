import { inferPdfProductCategory } from './scanner-pdf-category.mjs'

// Strict BRL parsing: reject ambiguous OCR strings (R$ 1300, R$ 12,0)
// instead of inventing a decimal separator.
const VALUE = '(?:\\d{1,3}(?:\\.\\d{3})+|\\d{1,6}),\\d{2}'
const WHOLE_VALUE = new RegExp('^(?:(?:R\\s*\\$|BRL)\\s*)?(' + VALUE + ')$', 'i')
const MARKED_VALUE = new RegExp(
  '(?:R\\s*\\$|BRL\\b|(?:pre[cç]o|valor|atacado)\\s*[:=-])\\s*(' + VALUE + ')(?![\\d,]|\\.\\d)', 'gi',
)
const BLOCKED_AMOUNT = /^(?:total(?:\s+geral|\s+do\s+kit)?|subtotal|frete|desconto|pedido\s+m[ií]nimo|parcelas?|economia)\s*[:=-]?/i
const NAME_LABEL = /^(?:nome(?:\s+do\s+produto)?|produto|modelo|item)\s*[:=-]\s*/i
const DESCRIPTION_LABEL = /^descri[cç][aã]o\s*[:=-]\s*/i
const PRODUCT_CLASS = /^(?:shampoo|condicionador|m[aá]scara|perfume|hidratante|creme|sabonete|s[eé]rum|[oó]leo|mai[oô]|biqu[ií]ni|sapato|sand[aá]lia|t[eê]nis)\b/i

function decimal(raw) {
  const numeric = Number(String(raw).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 1_000_000 ? numeric : null
}

export function parseBrazilianPrice(input) {
  const clean = String(input || '').replace(/\s+/g, ' ').trim()
  const direct = WHOLE_VALUE.exec(clean)
  if (direct) return decimal(direct[1])
  if (BLOCKED_AMOUNT.test(clean)) return null
  const marked = [...clean.matchAll(MARKED_VALUE)]
  if (marked.length !== 1) return null
  return decimal(marked[0][1])
}

// Prevent the legacy text parser from inventing cents on OCR-only pages.
// Native PDF amounts are never rewritten by this guard.
export function sanitizeAmbiguousOcrPrices(input) {
  return String(input || '').replace(/\b(?:R\s*\$|BRL)\s*\d[\d.,]*/gi, (fragment) => {
    const trailing = /[.,]+$/.exec(fragment)?.[0] || ''
    const token = trailing ? fragment.slice(0, -trailing.length) : fragment
    // The legacy parser intentionally accepts conventional 49.90 decimal dots.
    const validDotDecimal = /^(?:R\s*\$|BRL)\s*\d{1,6}\.\d{2}$/i.test(token)
    if (parseBrazilianPrice(token) != null || validDotDecimal) return fragment
    return 'PREÇO OCR AMBÍGUO - REVISÃO OBRIGATÓRIA' + trailing
  })
}

function priceOnLine(input) {
  const str = String(input || '').trim()
  if (BLOCKED_AMOUNT.test(str)) return null
  const marked = [...str.matchAll(MARKED_VALUE)]
  if (marked.length > 1) return null
  if (marked.length === 1) return { value: decimal(marked[0][1]), raw: marked[0][0], begin: marked[0].index, end: marked[0].index + marked[0][0].length }
  const direct = WHOLE_VALUE.exec(str)
  return direct ? { value: decimal(direct[1]), raw: str, begin: 0, end: str.length } : null
}

function normalizedLines(ocrResult) {
  if (!Array.isArray(ocrResult?.lines)) return []
  return ocrResult.lines.slice(0, 800).flatMap((entry, i) => {
    const box = Array.isArray(entry?.box) ? entry.box.map(Number) : []
    const text = String(entry?.text || '').replace(/\s+/g, ' ').trim().slice(0, 250)
    const score = entry?.score == null ? 1 : Number(entry.score)
    if (box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0 || n > 20_000) ||
        box[2] <= box[0] || box[3] <= box[1] || !text || !Number.isFinite(score) || score < 0.45) return []
    return [{
      id: i, text, box, score,
      cx: (box[0] + box[2]) / 2,
      cy: (box[1] + box[3]) / 2,
      height: box[3] - box[1],
    }]
  })
}

function validName(input) {
  const value = String(input || '').replace(/\s+/g, ' ').trim()
  const explicit = NAME_LABEL.test(value)
  const description = DESCRIPTION_LABEL.test(value)
  const name = value.replace(NAME_LABEL, '').replace(DESCRIPTION_LABEL, '').trim()
  if (name.length < 4 || name.length > 150 || !/[a-záàãâéêíóôõúç]/i.test(name)) return null
  if (/^(?:cat[aá]logo|cole[cç][aã]o|tabela|consulte|pedido|total|frete|desconto|cor(?:es)?|tamanho|tecido)\b/i.test(name)) return null
  const category = inferPdfProductCategory(name)
  if (category === 'Outros' && !PRODUCT_CLASS.test(name) && !explicit) return null
  // An unqualified description may be a paragraph, not a product title.
  if ((description || explicit) && name.split(/\s+/).length > 13) return null
  if (!explicit && !description && /^(?:de|com|em|para|tecido|tamanho|cores?)\s/i.test(name)) return null
  return { name, category, explicit }
}

// Geometric distance between OCR boxes, in units of text-line height.
// Requires same-row proximity OR a price below and aligned with its title.
// This avoids linking a price to the title of an adjacent column.
function spatialCost(anchor, target, allowBelow = false) {
  const h = Math.max(8, (anchor.height + target.height) / 2)
  const dy = target.cy - anchor.cy
  if (dy < -h * (allowBelow ? 4 : 0.9) || dy > h * 11) return Infinity
  const overlap = Math.min(anchor.box[2], target.box[2]) - Math.max(anchor.box[0], target.box[0])
  const gap = Math.max(0, -overlap)
  const centerDX = Math.abs(anchor.cx - target.cx)
  const sameRow = Math.abs(dy) <= 0.9 * h
  if (sameRow) {
    if (gap > 7 * h) return Infinity
  } else if (gap > 3.5 * h || centerDX > Math.max(9 * h, anchor.box[2] - anchor.box[0] + 4 * h)) {
    return Infinity
  }
  const cost = gap / h * 2.2 + Math.abs(dy) / h +
    (sameRow && target.cx < anchor.cx ? 0.75 : 0)
  return Number.isFinite(cost) && cost < 17 ? cost : Infinity
}

/**
 * Recover priced products from OCR coordinates instead of trusting OCR line order.
 * Conservatively accepts only explicit product-name anchors and one BRL amount per
 * price region. Visual matches are ALWAYS marked for seller review.
 */
export function associateOcrProducts(ocrResult, pageNumber, maxProducts = 500) {
  const lines = normalizedLines(ocrResult)
  if (!lines.length || !Number.isSafeInteger(pageNumber) || pageNumber <= 0) return []
  const prices = []
  const anchors = []
  const descriptions = []
  for (const line of lines) {
    const money = priceOnLine(line.text)
    if (money?.value != null) prices.push({ ...line, ...money })
    const remaining = money ? (line.text.slice(0, money.begin) + ' ' + line.text.slice(money.end)).trim() : line.text
    const title = validName(remaining)
    if (title) anchors.push({ ...line, ...title })
    else if (DESCRIPTION_LABEL.test(remaining)) {
      const detail = remaining.replace(DESCRIPTION_LABEL, '').trim()
      if (detail && detail.length <= 220) descriptions.push({ ...line, detail })
    }
  }
  if (!prices.length || !anchors.length) return []

  const edges = []
  for (let p = 0; p < prices.length; p++) {
    for (let a = 0; a < anchors.length; a++) {
      const cost = spatialCost(anchors[a], prices[p])
      if (Number.isFinite(cost)) edges.push({ p, a, cost })
    }
  }
  edges.sort((a, b) => a.cost - b.cost || a.p - b.p || a.a - b.a)
  const usedPrices = new Set()
  const usedAnchors = new Set()
  const matches = []
  for (const edge of edges) {
    if (usedPrices.has(edge.p) || usedAnchors.has(edge.a)) continue
    usedPrices.add(edge.p)
    usedAnchors.add(edge.a)
    const runnerUp = edges.find((other) =>
      other.p === edge.p && other.a !== edge.a && other.cost <= edge.cost + 1.2)
    matches.push({ ...edge, ambiguous: Boolean(runnerUp) })
    if (matches.length >= maxProducts) break
  }

  // Distinct description boxes are attached to the closest price, not simply
  // to the previous text line, which commonly belongs to another column.
  const detailsByPrice = new Map()
  for (const desc of descriptions) {
    const ranked = matches.map((match) => ({
      p: match.p,
      cost: spatialCost(desc, prices[match.p], true),
    })).filter((entry) => Number.isFinite(entry.cost))
      .sort((a, b) => a.cost - b.cost)
    if (!ranked.length || (ranked[1] && ranked[1].cost - ranked[0].cost < 1.2)) continue
    const values = detailsByPrice.get(ranked[0].p) || []
    if (values.length < 4) values.push(desc.detail)
    detailsByPrice.set(ranked[0].p, values)
  }

  return matches.sort((a, b) => prices[a.p].cy - prices[b.p].cy ||
    prices[a.p].cx - prices[b.p].cx).map(({ p, a, ambiguous }, i) => {
    const title = anchors[a]
    const money = prices[p]
    const descriptions = detailsByPrice.get(p) || []
    const note = ambiguous
      ? 'REVISÃO OBRIGATÓRIA: há mais de um possível nome para o preço na página.'
      : 'REVISÃO OBRIGATÓRIA: vínculo entre nome, descrição e preço inferido por coordenadas OCR.'
    return {
      title: title.name,
      description: [...descriptions, note].join(' ').slice(0, 2000),
      sku: '',
      category: title.category,
      price: money.value,
      price_text: money.raw.trim(),
      currency: 'BRL',
      images: [], properties: [], variants: [],
      source: 'pdf',
      source_url: 'pdf://page/' + pageNumber + '/ocr-spatial/' + i,
      external_id: 'pdf-ocr-spatial-p' + pageNumber + '-' + i,
      pdf_page: pageNumber,
      pdf_review_required: true,
      pdf_spatial_match: true,
    }
  })
}
