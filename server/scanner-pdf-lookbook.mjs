import { inferPdfProductCategory } from './scanner-pdf-category.mjs'

const TYPES = 'BRINCO|COLAR|PULSEIRA|BRACELETE|BRACELE|BACELETE|BROCHE|BOLSA|ANEL|CINTO|CHOKER|GARGANTILHA|TIARA|LENCO|LENÇO|ECHARPE|CONJUNTO|PRESILHA|TORNOZELEIRA'
const labelPattern = new RegExp('^(' + TYPES + ')\\s+0?([1-9][0-9]?)(?:\\s+(?:E|\\+|/|,)\\s*0?([1-9][0-9]?))?$', 'i')
const labelScan = new RegExp('\\b(' + TYPES + ')\\s+0?([1-9][0-9]?)(?:\\s+(?:E|\\+|/|,)\\s*0?([1-9][0-9]?))?(?=\\s|$)', 'gi')
const pricesPattern = /\b(0?[1-9]|[1-9][0-9])\s*R\$\s*(\d{1,6}(?:\.\d{3})*,\d{2})\b/g

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const number = (value) => Number(value)
const naturalName = (value) => value.charAt(0).toUpperCase() + value.slice(1).toLocaleLowerCase('pt-BR')

function labelsFromText(value) {
  const labels = new Map()
  for (const match of clean(value).matchAll(labelScan)) {
    const title = match[1].toUpperCase().replace(/^(?:BRACELE|BACELETE)$/, 'BRACELETE')
    for (const raw of [match[2], match[3]]) {
      if (!raw) continue
      const item = number(raw)
      if (!labels.has(item)) labels.set(item, naturalName(title))
    }
  }
  return labels
}

function pricesFromText(value) {
  const prices = new Map()
  for (const match of clean(value).matchAll(pricesPattern)) {
    const item = number(match[1])
    const price = Number(match[2].replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) continue
    if (!prices.has(item)) prices.set(item, price)
  }
  return prices
}

function collectionFromIntro(pages) {
  const intro = pages.slice(0, 3).join(' ').normalize('NFC')
  const match = /\b(MEMORIES|ORIGEM|COSTA|LUME)\b/i.exec(intro)
  return match ? naturalName(match[1]) : ''
}

/**
 * Fashion lookbooks may put item-numbered prices on one page and the
 * item names/variation photos on a subsequent CORES DISPONÍVEIS page.
 * We join only on the explicitly printed item number, never on position alone.
 * Unlabelled priced items stay in review as unknown types; SKUs are not invented.
 */
export function parseNumberedLookbookPages(rawPages, maxProducts = 500) {
  const pages = Array.isArray(rawPages) ? rawPages : String(rawPages || '').replace(/\r/g, '').split('\f')
  const groups = pages.map((page) => pricesFromText(page))
  const detail = pages.map((page) => /\bCORES\s+DISPON[IÍ]VEIS\b/i.test(clean(page)))
  const labels = pages.map((page, index) => detail[index] ? labelsFromText(page) : new Map())
  const pricedPages = groups.map((items, i) => items.size ? i : -1).filter((i) => i >= 0)
  let linked = 0
  const pageLinks = new Map()
  for (let index = 0; index < pricedPages.length; index += 1) {
    const pricePage = pricedPages[index]
    const nextPrice = pricedPages[index + 1] ?? pages.length
    let detailPage = -1
    // A full-page editorial photo may sit between the price and product board.
    for (let p = pricePage + 1; p < Math.min(nextPrice, pricePage + 5); p += 1) {
      if (detail[p] && labels[p].size) { detailPage = p; break }
    }
    pageLinks.set(pricePage, detailPage)
    if (detailPage >= 0) for (const item of groups[pricePage].keys()) if (labels[detailPage].has(item)) linked += 1
  }
  // Prevent hijacking ordinary catalogs that happen to enumerate prices.
  if (pricedPages.length < 2 || linked < 2 || !detail.some(Boolean)) return null
  const collection = collectionFromIntro(pages)
  const candidates = []
  for (const pricePage of pricedPages) {
    const detailPage = pageLinks.get(pricePage)
    const names = detailPage >= 0 ? labels[detailPage] : new Map()
    for (const [item, price] of groups[pricePage]) {
      if (candidates.length >= maxProducts) break
      const printedType = names.get(item)
      // Some supplier boards are mislabelled (the Memories bag board says
      // "BRINCO 01" while the pictured item is a bag). Keep unusual high-priced
      // earring labels as uncertain rather than silently assigning a wrong category.
      const suspectType = printedType === 'Brinco' && price >= 100
      const type = suspectType ? null : printedType
      const printableItem = String(item).padStart(2, '0')
      const pricePageNumber = pricePage + 1
      const title = type
        ? type + ' ' + printableItem + (collection ? ' · ' + collection : '') + ' · pág. ' + pricePageNumber
        : 'Peça ' + printableItem + ' (tipo a confirmar)' + (collection ? ' · ' + collection : '') + ' · pág. ' + pricePageNumber
      const description = 'Item ' + printableItem + ' com preço impresso na página ' + pricePageNumber +
        (detailPage >= 0 ? '; apresentação de cores na página ' + (detailPage + 1) : '') +
        '. Confira o modelo e as variações na revisão antes de publicar.' +
        (suspectType ? ' Atenção: tipo impresso potencialmente incorreto; confirme pela foto.' : '')
      candidates.push({
        title, description, sku: '', category: type ? inferPdfProductCategory(type) : 'Geral',
        price, currency: 'BRL', images: [], properties: [], variants: [],
        source: 'pdf', source_url: 'pdf://page/' + pricePageNumber + '/item/' + printableItem,
        external_id: 'pdf-lookbook-p' + pricePageNumber + '-i' + printableItem,
        pdf_page: pricePageNumber, pdf_detail_page: detailPage >= 0 ? detailPage + 1 : null,
        pdf_item_number: item, pdf_lookbook: true,
      })
    }
  }
  return { candidates, pagesScanned: pages.filter((page) => clean(page)).length, lookbook: true }
}

const decodeXml = (value) => String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

/**
 * Extract vertical image regions directly from Poppler bounding boxes.
 * Only the named product's own section of the CORES DISPONÍVEIS board is used.
 */
export function parseLookbookPhotoBands(bbox) {
  const regions = new Map()
  const pagePattern = /<page\s+([^>]+)>([\s\S]*?)<\/page>/gi
  let pageMatch
  let pageNo = 0
  while ((pageMatch = pagePattern.exec(String(bbox || '')))) {
    pageNo += 1
    const attrs = pageMatch[1]
    const width = Number(/\bwidth="([\d.]+)"/.exec(attrs)?.[1])
    const height = Number(/\bheight="([\d.]+)"/.exec(attrs)?.[1])
    if (!(width > 0 && height > 0 && width < 50000 && height < 50000)) continue
    const lines = []
    const linePattern = /<line\s+([^>]+)>([\s\S]*?)<\/line>/gi
    let lineMatch
    while ((lineMatch = linePattern.exec(pageMatch[2]))) {
      const top = Number(/\byMin="([\d.]+)"/.exec(lineMatch[1])?.[1])
      const words = [...lineMatch[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi)].map((match) => decodeXml(match[1]))
      const label = labelPattern.exec(clean(words.join(' ')))
      if (!label || !Number.isFinite(top)) continue
      const items = [number(label[2]), ...(label[3] ? [number(label[3])] : [])]
      lines.push({ top, items })
    }
    lines.sort((a, b) => a.top - b.top)
    for (let i = 0; i < lines.length; i += 1) {
      const start = Math.max(0, lines[i].top - 10)
      const end = Math.min(height, i + 1 < lines.length ? lines[i + 1].top - 10 : height - 4)
      if (end - start < 60) continue
      for (const item of lines[i].items) regions.set(pageNo + ':' + item, { page: pageNo, top: start, bottom: end, width, height })
    }
  }
  return regions
}
