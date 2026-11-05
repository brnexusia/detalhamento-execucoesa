import { inferPdfProductCategory } from './scanner-pdf-category.mjs'

const TYPES = 'BRINCO|COLAR|PULSEIRA|BRACELETE|BRACELE|BACELETE|BROCHE|BOLSA|ANEL|CINTO|CHOKER|GARGANTILHA|TIARA|LENCO|LENÇO|ECHARPE|CONJUNTO|PRESILHA|TORNOZELEIRA|GOLA'
const labelPattern = new RegExp('^(' + TYPES + ')\\s+0?([1-9][0-9]?)(?:\\s+(?:E|\\+|/|,)\\s*0?([1-9][0-9]?))?(?:\\s*[-–]\\s*KIT)?$', 'i')
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
  const prices = pages.map(pricesFromText)
  const boards = pages.map((page) => /\bCORES\s+DISPON[IÍ]VEIS\b/i.test(clean(page)))
  const labels = pages.map((page, index) => boards[index] ? labelsFromText(page) : new Map())
  const looks = []
  for (let page = 0; page < pages.length; page += 1) {
    const entries = prices[page]
    if (entries.size) {
      const previous = looks.at(-1)
      const sameLook = previous && !previous.detailPages.length &&
        page - previous.pricePages.at(-1) <= 2 &&
        [...entries.keys()].every((id) => !previous.itemIds.has(id))
      // A price board can be split over successive editorial/model pages:
      // Costa has items 01-04 on p5 and item 05 on p6, with one shared p7 board.
      // A repeated item 01 starts a NEW look (Memories bag p60 versus p61).
      if (sameLook) {
        previous.pricePages.push(page)
        for (const [id, amount] of entries) {
          previous.itemIds.add(id)
          previous.items.push({ id, amount, pricePage: page })
        }
      } else {
        looks.push({
          pricePages: [page], detailPages: [],
          itemIds: new Set(entries.keys()),
          items: [...entries].map(([id, amount]) => ({ id, amount, pricePage: page })),
        })
      }
    } else if (boards[page] && looks.length) {
      const look = looks.at(-1)
      const last = look.detailPages.at(-1) ?? look.pricePages.at(-1)
      // Up to 4 intervening image-only pages between a priced look and board.
      if (page - last <= 5) look.detailPages.push(page)
    }
  }
  let paired = 0
  for (const look of looks) {
    const resolved = new Map()
    const labelPages = new Map()
    for (const page of look.detailPages) {
      for (const [id, type] of labels[page]) {
        if (!look.itemIds.has(id)) continue
        if (resolved.has(id) && resolved.get(id) !== type) {
          resolved.set(id, null) // contradicting printed labels, review required
          labelPages.delete(id)
        } else if (!resolved.has(id)) {
          resolved.set(id, type)
          labelPages.set(id, page)
        }
      }
    }
    look.labels = resolved
    look.labelPages = labelPages
    paired += [...resolved.values()].filter(Boolean).length
  }
  // A false positive in an ordinary numbered price list must never replace
  // the normal catalog parser. Require multiple price blocks AND visual boards.
  if (paired < 2 || !boards.some(Boolean) || (looks.length < 2 && looks[0]?.items.length < 2)) return null

  const collection = collectionFromIntro(pages)
  const candidates = []
  for (let lookNumber = 0; lookNumber < looks.length && candidates.length < maxProducts; lookNumber += 1) {
    const look = looks[lookNumber]
    for (const { id, amount, pricePage } of look.items) {
      if (candidates.length >= maxProducts) break
      const printedType = look.labels.get(id) || ''
      // Some supplier pages mislabel expensive bags as "BRINCO". The source
      // itself is inconsistent: do not silently publish a fabricated category.
      const suspicious = printedType === 'Brinco' && amount >= 100
      const type = suspicious ? '' : printedType
      const no = String(id).padStart(2, '0')
      const pageNo = pricePage + 1
      const lookNo = String(lookNumber + 1).padStart(2, '0')
      const typePage = look.labelPages.get(id)
      const friendlyName = type
        ? type + ' ' + no + (collection ? ' · ' + collection : '') + ' · Look ' + lookNo
        : 'Peça ' + no + ' (tipo a confirmar)' + (collection ? ' · ' + collection : '') + ' · Look ' + lookNo
      const description = 'Referência visual do catálogo: look ' + lookNo + ', item ' + no +
        ', preço impresso na página ' + pageNo +
        (typePage !== undefined ? ', fotos na página ' + (typePage + 1) : ', sem foto individual identificada') +
        '. Confira nome, foto e variações antes de publicar.' +
        (suspicious ? ' A legenda do fornecedor pode estar incorreta.' : '')
      candidates.push({
        title: friendlyName, description, sku: '', category: type ? inferPdfProductCategory(type) : 'Geral',
        price: amount, currency: 'BRL', images: [], properties: [], variants: [],
        source: 'pdf', source_url: 'pdf://look/' + lookNo + '/page/' + pageNo + '/item/' + no,
        external_id: 'pdf-look-' + lookNo + '-p' + pageNo + '-item' + no,
        pdf_page: pageNo, pdf_detail_page: typePage === undefined ? null : typePage + 1,
        pdf_item_number: id, pdf_lookbook: true,
        pdf_needs_review: !type,
      })
    }
  }
  return {
    candidates, pagesScanned: pages.filter((page) => clean(page)).length,
    lookbook: true, lookCount: looks.length,
    unlabelled: candidates.filter((candidate) => candidate.pdf_needs_review).length,
  }
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
      const bottom = Number(/\byMax="([\d.]+)"/.exec(lineMatch[1])?.[1])
      const words = [...lineMatch[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi)].map((match) => decodeXml(match[1]))
      const label = labelPattern.exec(clean(words.join(' ')))
      if (!label || !Number.isFinite(top) || !Number.isFinite(bottom)) continue
      const items = [number(label[2]), ...(label[3] ? [number(label[3])] : [])]
      lines.push({ top, bottom, items })
    }
    lines.sort((a, b) => a.top - b.top)
    for (let i = 0; i < lines.length; i += 1) {
      const start = Math.max(0, lines[i].bottom + 8)
      const end = Math.min(height, i + 1 < lines.length ? lines[i + 1].top - 10 : height - 4)
      if (end - start < 35) continue
      for (const item of lines[i].items) regions.set(pageNo + ':' + item, { page: pageNo, top: start, bottom: end, width, height })
    }
  }
  return regions
}
, 'i')
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
  const prices = pages.map(pricesFromText)
  const boards = pages.map((page) => /\bCORES\s+DISPON[IÍ]VEIS\b/i.test(clean(page)))
  const labels = pages.map((page, index) => boards[index] ? labelsFromText(page) : new Map())
  const looks = []
  for (let page = 0; page < pages.length; page += 1) {
    const entries = prices[page]
    if (entries.size) {
      const previous = looks.at(-1)
      const sameLook = previous && !previous.detailPages.length &&
        page - previous.pricePages.at(-1) <= 2 &&
        [...entries.keys()].every((id) => !previous.itemIds.has(id))
      // A price board can be split over successive editorial/model pages:
      // Costa has items 01-04 on p5 and item 05 on p6, with one shared p7 board.
      // A repeated item 01 starts a NEW look (Memories bag p60 versus p61).
      if (sameLook) {
        previous.pricePages.push(page)
        for (const [id, amount] of entries) {
          previous.itemIds.add(id)
          previous.items.push({ id, amount, pricePage: page })
        }
      } else {
        looks.push({
          pricePages: [page], detailPages: [],
          itemIds: new Set(entries.keys()),
          items: [...entries].map(([id, amount]) => ({ id, amount, pricePage: page })),
        })
      }
    } else if (boards[page] && looks.length) {
      const look = looks.at(-1)
      const last = look.detailPages.at(-1) ?? look.pricePages.at(-1)
      // Up to 4 intervening image-only pages between a priced look and board.
      if (page - last <= 5) look.detailPages.push(page)
    }
  }
  let paired = 0
  for (const look of looks) {
    const resolved = new Map()
    const labelPages = new Map()
    for (const page of look.detailPages) {
      for (const [id, type] of labels[page]) {
        if (!look.itemIds.has(id)) continue
        if (resolved.has(id) && resolved.get(id) !== type) {
          resolved.set(id, null) // contradicting printed labels, review required
          labelPages.delete(id)
        } else if (!resolved.has(id)) {
          resolved.set(id, type)
          labelPages.set(id, page)
        }
      }
    }
    look.labels = resolved
    look.labelPages = labelPages
    paired += [...resolved.values()].filter(Boolean).length
  }
  // A false positive in an ordinary numbered price list must never replace
  // the normal catalog parser. Require multiple price blocks AND visual boards.
  if (looks.length < 2 || paired < 2 || !boards.some(Boolean)) return null

  const collection = collectionFromIntro(pages)
  const candidates = []
  for (let lookNumber = 0; lookNumber < looks.length && candidates.length < maxProducts; lookNumber += 1) {
    const look = looks[lookNumber]
    for (const { id, amount, pricePage } of look.items) {
      if (candidates.length >= maxProducts) break
      const printedType = look.labels.get(id) || ''
      // Some supplier pages mislabel expensive bags as "BRINCO". The source
      // itself is inconsistent: do not silently publish a fabricated category.
      const suspicious = printedType === 'Brinco' && amount >= 100
      const type = suspicious ? '' : printedType
      const no = String(id).padStart(2, '0')
      const pageNo = pricePage + 1
      const lookNo = String(lookNumber + 1).padStart(2, '0')
      const typePage = look.labelPages.get(id)
      const friendlyName = type
        ? type + ' ' + no + (collection ? ' · ' + collection : '') + ' · Look ' + lookNo
        : 'Peça ' + no + ' (tipo a confirmar)' + (collection ? ' · ' + collection : '') + ' · Look ' + lookNo
      const description = 'Referência visual do catálogo: look ' + lookNo + ', item ' + no +
        ', preço impresso na página ' + pageNo +
        (typePage !== undefined ? ', fotos na página ' + (typePage + 1) : ', sem foto individual identificada') +
        '. Confira nome, foto e variações antes de publicar.' +
        (suspicious ? ' A legenda do fornecedor pode estar incorreta.' : '')
      candidates.push({
        title: friendlyName, description, sku: '', category: type ? inferPdfProductCategory(type) : 'Geral',
        price: amount, currency: 'BRL', images: [], properties: [], variants: [],
        source: 'pdf', source_url: 'pdf://look/' + lookNo + '/page/' + pageNo + '/item/' + no,
        external_id: 'pdf-look-' + lookNo + '-p' + pageNo + '-item' + no,
        pdf_page: pageNo, pdf_detail_page: typePage === undefined ? null : typePage + 1,
        pdf_item_number: id, pdf_lookbook: true,
        pdf_needs_review: !type,
      })
    }
  }
  return {
    candidates, pagesScanned: pages.filter((page) => clean(page)).length,
    lookbook: true, lookCount: looks.length,
    unlabelled: candidates.filter((candidate) => candidate.pdf_needs_review).length,
  }
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
      const bottom = Number(/\byMax="([\d.]+)"/.exec(lineMatch[1])?.[1])
      const words = [...lineMatch[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi)].map((match) => decodeXml(match[1]))
      const label = labelPattern.exec(clean(words.join(' ')))
      if (!label || !Number.isFinite(top) || !Number.isFinite(bottom)) continue
      const items = [number(label[2]), ...(label[3] ? [number(label[3])] : [])]
      lines.push({ top, bottom, items })
    }
    lines.sort((a, b) => a.top - b.top)
    for (let i = 0; i < lines.length; i += 1) {
      const start = Math.max(0, lines[i].bottom + 8)
      const end = Math.min(height, i + 1 < lines.length ? lines[i + 1].top - 10 : height - 4)
      if (end - start < 35) continue
      for (const item of lines[i].items) regions.set(pageNo + ':' + item, { page: pageNo, top: start, bottom: end, width, height })
    }
  }
  return regions
}
