import { inferPdfProductCategory } from './scanner-pdf-category.mjs'

// Layout rules are generic: the Spetacolo PDFs are regression fixtures, not a
// merchant-name trigger. Editorial price pages and boards are separate assets.
const TYPES = String.raw`PULSEIRA\s*\/\s*BRACELETE|BRINCO|COLAR|PULSEIRA|BRACELETE|BRACELE|BACELETE|BROCHE|BOLSA|ANEL|CINTO|CHOKER|GARGANTILHA|TIARA|LENCO|LENÇO|ECHARPE|CONJUNTO|PRESILHA|TORNOZELEIRA|PAREÔ|PAREO|TOUCA|TOCA|GOLA`
const LABEL = new RegExp(String.raw`\b(` + TYPES + String.raw`)\s+0?([1-9][0-9]?)(?:\s*(?:E|\+|\/|,)\s*0?([1-9][0-9]?))?`, 'gi')
const SINGLE_TYPE = new RegExp(String.raw`^\s*(` + TYPES + String.raw`)\s*$`, 'i')
const PRICE = /\b(0?[1-9]|[1-9][0-9])\s*R\$\s*(\d{1,6}(?:\.\d{3})*(?:,\d{0,2})?)(?![\d,])/gi
const clean = (raw) => String(raw || '').replace(/\s+/g, ' ').trim()
const normalize = (raw) => clean(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
function typeName(raw) {
  const key = normalize(raw)
  if (key.includes('PULSEIRA') && key.includes('BRACELETE')) return 'Pulseira/Bracelete'
  if (['BRACELE', 'BACELETE'].includes(key)) return 'Bracelete'
  if (key === 'TOCA') return 'Touca'
  return key.charAt(0) + key.slice(1).toLocaleLowerCase('pt-BR')
}
function collectionFrom(pages) {
  const intro = pages.slice(0, 4).join(' ')
  const found = /\b(MEMORIES|ORIGEM|COSTA|LUME)\b/i.exec(intro)
  return found ? typeName(found[1]) : 'Catálogo'
}
function pricesFromPage(raw) {
  const result = new Map()
  for (const match of String(raw || '').matchAll(PRICE)) {
    const index = Number(match[1])
    const rawPrice = match[2]
    let price = null
    if (/^\d{1,6}(?:\.\d{3})*,\d{2}$/.test(rawPrice)) {
      const value = Number(rawPrice.replace(/\./g, '').replace(',', '.'))
      if (Number.isFinite(value) && value > 0 && value <= 1000000) price = value
    } else if (/^\d{1,3}$/.test(rawPrice)) {
      const value = Number(rawPrice)
      if (value > 0) price = value
    }
    // "R$ 1300" and "R$ 12,0" are ambiguous: flag rather than invent.
    if (!result.has(index)) result.set(index, { price, raw: rawPrice })
  }
  return result
}
function labelsFromPage(raw) {
  const labels = new Map()
  const str = clean(raw)
  for (const match of str.matchAll(LABEL)) {
    const name = typeName(match[1])
    for (const rawId of [match[2], match[3]]) {
      if (!rawId) continue
      const id = Number(rawId)
      const choices = labels.get(id) || new Set()
      choices.add(name)
      labels.set(id, choices)
    }
  }
  // Some boards (e.g. a sole bag) print "BOLSA" without an item number.
  const standalone = []
  for (const line of String(raw || '').split(/\n/)) {
    const found = SINGLE_TYPE.exec(line.trim())
    if (found) standalone.push(typeName(found[1]))
  }
  return { labels, standalone }
}
function isBoard(page) {
  return /\bCORES\s+DISPON[IÍ]VEIS\b/i.test(clean(page))
}
function groupPages(pages) {
  const groups = []
  let current = null
  for (let i = 0; i < pages.length; i += 1) {
    const money = pricesFromPage(pages[i])
    const board = isBoard(pages[i])
    if (money.size) {
      if (!current || current.boards.length || i - current.lastPrice > 2) {
        current = { pricePages: [], prices: new Map(), boards: [], lastPrice: i }
        groups.push(current)
      }
      current.pricePages.push(i)
      current.lastPrice = i
      for (const [id, value] of money) {
        const existing = current.prices.get(id)
        if (existing && existing.price !== value.price) {
          current.prices.set(id, { price: null, raw: value.raw, page: i, conflict: true })
        } else if (!existing) current.prices.set(id, { ...value, page: i, conflict: false })
      }
    }
    if (board && current) current.boards.push(i)
  }
  return groups
}

/**
 * Cross-page item pairing is based only on supplier-printed item numbers,
 * across ALL consecutive board pages (not merely the first). A missing name
 * or corrupt price stays in review rather than becoming a guessed product.
 */
export function parseNumberedLookbookPages(rawPages, maxProducts = 500) {
  const pages = Array.isArray(rawPages) ? rawPages : String(rawPages || '').replace(/\r/g, '').split('\f')
  const groups = groupPages(pages)
  const joined = groups.map((group) => {
    const labels = new Map()
    const unnumbered = []
    for (const boardPage of group.boards) {
      const part = labelsFromPage(pages[boardPage])
      for (const [id, types] of part.labels) {
        if (!labels.has(id)) labels.set(id, new Map())
        for (const type of types) {
          const existing = labels.get(id)
          if (!existing.has(type)) existing.set(type, boardPage)
        }
      }
      unnumbered.push(...part.standalone)
    }
    return { ...group, labels, unnumbered }
  })
  const matched = joined.reduce((n, group) => n +
    [...group.prices.keys()].filter((id) => group.labels.has(id)).length, 0)
  if (joined.length < 2 || matched < 2 || !joined.some((group) => group.boards.length)) return null

  const collection = collectionFrom(pages)
  const candidates = []
  for (let index = 0; index < joined.length && candidates.length < maxProducts; index += 1) {
    const group = joined[index]
    const groupId = String(index + 1).padStart(2, '0')
    for (const [id, rawPrice] of group.prices) {
      if (candidates.length >= maxProducts) break
      const choices = group.labels.get(id)
      const uniqueTypes = choices ? [...choices.keys()] : []
      if (!uniqueTypes.length && group.prices.size === 1 && group.unnumbered.length === 1) {
        uniqueTypes.push(group.unnumbered[0])
      }
      const conflictingLabels = uniqueTypes.length > 1
      let type = uniqueTypes.length === 1 ? uniqueTypes[0] : null
      // Mislabelled photo board in Memories: an R$ 140 "BRINCO" is a bag.
      const suspect = type === 'Brinco' && rawPrice.price >= 100
      if (suspect) type = null
      const needsReview = !type || rawPrice.price == null || rawPrice.conflict
      const item = String(id).padStart(2, '0')
      const ref = groupId + '-' + item
      const pricePage = rawPrice.page + 1
      const photoPage = type && choices?.has(type) ? choices.get(type) + 1 :
        (!conflictingLabels && group.prices.size === 1 && group.boards.length === 1 ? group.boards[0] + 1 : null)
      const name = type ? type + ' · ' + collection + ' · ' + ref
        : 'Acessório para identificar · ' + collection + ' · ' + ref
      const hints = ['Coleção ' + collection + ', look ' + groupId + ', item ' + item + '.',
        'Preço impresso na página ' + pricePage + '.']
      if (photoPage) hints.push('Variações na página ' + photoPage + '.')
      if (needsReview) hints.push('REVISÃO OBRIGATÓRIA: conferir tipo, fotografia e/ou preço no PDF original.')
      candidates.push({
        title: name, description: hints.join(' '), sku: '',
        category: type ? inferPdfProductCategory(type) : 'Geral',
        price: rawPrice.price, price_text: rawPrice.raw, currency: 'BRL',
        images: [], variants: [], properties: [], source: 'pdf',
        source_url: 'pdf://page/' + pricePage + '/item/' + item,
        external_id: 'pdf-lookbook-p' + pricePage + '-i' + item,
        pdf_page: pricePage, pdf_detail_page: photoPage,
        pdf_item_number: id, pdf_lookbook: true, pdf_review_required: Boolean(needsReview),
      })
    }
  }
  return { candidates, pagesScanned: pages.filter((page) => clean(page)).length, lookbook: true }
}
function xml(raw) { return String(raw || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'") }

/** Bounding box for each individual supplier-label section of a photo board. */
export function parseLookbookPhotoBands(bbox) {
  const regions = new Map()
  const pages = [...String(bbox || '').matchAll(/<page\s+([^>]+)>([\s\S]*?)<\/page>/gi)]
  pages.forEach((page, pageIndex) => {
    const w = Number(/\bwidth="([\d.]+)"/.exec(page[1])?.[1])
    const h = Number(/\bheight="([\d.]+)"/.exec(page[1])?.[1])
    if (!(w > 0 && h > 0 && w <= 50000 && h <= 50000)) return
    const matches = []
    for (const line of page[2].matchAll(/<line\s+([^>]+)>([\s\S]*?)<\/line>/gi)) {
      const top = Number(/\byMin="([\d.]+)"/.exec(line[1])?.[1])
      const left = Number(/\bxMin="([\d.]+)"/.exec(line[1])?.[1] || 0)
      const words = [...line[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi)]
        .map((value) => xml(value[1])).join(' ')
      const items = labelsFromPage(words).labels
      if (items.size && Number.isFinite(top)) matches.push({ top, left, ids: [...items.keys()] })
    }
    matches.sort((a, b) => a.top - b.top || a.left - b.left)
    const rows = []
    for (const match of matches) {
      const row = rows.find((entry) => Math.abs(entry.top - match.top) < 35)
      if (row) row.labels.push(match)
      else rows.push({ top: match.top, labels: [match] })
    }
    rows.sort((a,b) => a.top - b.top)
    rows.forEach((row, ri) => {
      const top = Math.max(0, row.top - 12)
      const bottom = Math.min(h, ri + 1 < rows.length ? rows[ri+1].top - 12 : h - 10)
      if (bottom - top < 60) return
      row.labels.sort((a, b) => a.left - b.left)
      row.labels.forEach((label, li) => {
        const left = Math.max(0, li ? (row.labels[li-1].left + label.left) / 2 : 0)
        const right = Math.min(w, li + 1 < row.labels.length ?
          (label.left + row.labels[li+1].left) / 2 : w)
        if (right - left < 50) return
        for (const id of label.ids) regions.set((pageIndex+1) + ':' + id,
          { page: pageIndex+1, top, bottom, left, right, width:w, height:h })
      })
    })
  })
  return regions
}
