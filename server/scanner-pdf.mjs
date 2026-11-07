import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { inferPdfProductCategory } from './scanner-pdf-category.mjs'
import { parseNumberedLookbookPages, parseLookbookPhotoBands } from './scanner-pdf-lookbook.mjs'
import { parseReferenceOnlyPdfProducts } from './scanner-pdf-review-fallback.mjs'
import { parseNamedUnpricedPdfProducts } from './scanner-pdf-named-products.mjs'
import { parseFashionPhotoPages } from './scanner-pdf-fashion-pages.mjs'
import { parseTesseractTsv } from './scanner-pdf-tesseract.mjs'
import { associateOcrProducts, sanitizeAmbiguousOcrPrices } from './scanner-pdf-spatial.mjs'
import { parsePdfVisualGeometry, numberedPhotoRegions, associateNativePricesByProximity, proximityPhotoRegions, parseNumberedReferenceFallback } from './scanner-pdf-visual-association.mjs'

const run = promisify(execFile)
export const MAX_PDF_BYTES = 100 * 1024 * 1024
export const MAX_PDF_PAGES = 200
const MAX_PRODUCTS = 500
const MAX_IMAGES = 220
// PDF/image expansion bomb guardrails. All conversions run with OS-enforced
// address-space, CPU and generated-file limits; image metadata is checked
// before extracting even a single embedded photo.
const MAX_IMAGE_EDGE = 10_000
const MAX_IMAGE_PIXELS = 25_000_000
const MAX_TOTAL_IMAGE_PIXELS = 192_000_000
const MAX_IMAGE_LIST_ENTRIES = 2_000
const MAX_EXTRACTED_PRODUCT_PHOTOS = 200
const MAX_PHOTO_PAGES_PER_PRODUCT = 3
// Photographs are decoded one page at a time and deleted immediately.
// This cumulative CPU work allowance is separate from the per-page decompression budget.
const MAX_CUMULATIVE_EXTRACTED_PIXELS = 800_000_000
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
const MAX_GENERATED_FILE_BYTES = 16 * 1024 * 1024
const MAX_PDF_PROCESSING_MS = 5 * 60_000
const MAX_TOOL_OUTPUT_BYTES = 8 * 1024 * 1024
const PDF_PROCESS_LIMITS = [
  '--as=1073741824', // 1 GiB virtual address space per converter, not the Node worker
  '--cpu=75',          // CPU seconds (also have short wall-clock timeouts)
  '--fsize=' + MAX_GENERATED_FILE_BYTES,
  '--',
]
export class PdfSafetyError extends Error { constructor(message) { super(message); this.name = 'PdfSafetyError' } }
const UNSAFE_PDF_MESSAGE = 'O PDF excedeu os limites seguros de processamento (tempo, memória, imagens ou dados descompactados). Reduza a complexidade do arquivo e tente novamente.'

function text(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function priceFromLine(line) {
  // Kit totals and amounts for payment/discounts are not individual products.
  if (/^\s*(?:TOTAL|SUBTOTAL|TOTAL DO KIT|TOTAL GERAL|FRETE|DESCONTO)\s*[:=-]/i.test(String(line))) return null
  // Some exported catalogs use a dot for decimal cents (R$ 49.90).
  // Check these BEFORE the integer pattern, which would read them as R$ 49.
  const dotPrices = [...String(line).matchAll(/(?:R\$|BRL|pre[cç]o|atacado|varejo|valor)\s*[:=-]?\s*(\d{1,6}\.\d{2})(?![\d,])/gi)]
    .map(match => Number(match[1])).filter(value => value > 0 && value <= 1000000)
  if (dotPrices.length) return Math.min(...dotPrices)
  const matches = [...String(line).matchAll(/(?:R\$\s*|(?:pre[cç]o|atacado|varejo|valor)\s*(?:de|:|-)?\s*)(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}(?:\.\d{3})*)/gi)]
  const prices = matches.map((match) => {
    const value = match[1].replace(/\./g, '').replace(',', '.')
    return Number(value)
  }).filter((value) => value > 0 && value <= 1000000)
  if (prices.length) return Math.min(...prices)
  // Some wholesale PDFs print only a monetary amount on the next line,
  // without the R$ prefix. Accept ONLY the unambiguous comma-decimal form.
  const bare= /^\s*(?:R\$\s*)?(\d{1,6}(?:\.\d{3})*,\d{2})\s*$/.exec(String(line))
  if (!bare) return null
  const parsed=Number(bare[1].replace(/\./g,'').replace(',','.'))
  return Number.isFinite(parsed)&&parsed>0&&parsed<=1000000?parsed:null
}

function referenceFrom(textValue) {
  return /(?:ref(?:er[eê]ncia)?|c[oó]d(?:igo)?|sku|modelo)\s*[.:#-]?\s*([A-Z0-9][A-Z0-9./-]{1,40})/i.exec(textValue)?.[1] || ''
}

function isNonTitle(line) {
  const value = text(line)
  const label = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[:.#\s-]+$/g, '').toLowerCase()
  const priceLabel = /^(?:preco(?:\s+de)?(?:\s+(?:atacado|varejo|promocional))?|valor(?:\s+(?:atacado|varejo))?|atacado|varejo)$/.test(label)
  return !value || value.length < 3 || priceLabel || /^R\$\s*[\d.,]+/i.test(value) ||
    /^(?:pre[cç]o|valor|atacado|varejo|ref(?:er[eê]ncia)?|c[oó]digo|sku|modelo|tam(?:anho)?|cor(?:es)?|p[aá]g(?:ina)?|whats(?:app)?|tel(?:efone)?|instagram|pedido m[ií]nimo|quantidade|dispon[ií]vel|pix)\s*[:.#-]/i.test(value) ||
    /^[\d\s.,/()\-]+$/.test(value) || /^(?:cat[aá]logo|cole[cç][aã]o|tabela de pre[cç]os|nova cole[cç][aã]o|frete|envio)$/i.test(value)
}

function titleFor(lines, index, after) {
  const current = text(lines[index]
    .replace(/(?:R\$\s*|(?:pre[cç]o|atacado|varejo|valor)\s*(?:de|:|-)?\s*)\d{1,6}(?:\.\d{3})*(?:,\d{2})?/gi, '')
    .replace(/@[\w.-]{2,100}\b/gi, '')
    .replace(/\s+(?:CONTATOS|CONTATO|WHATSAPP|INSTAGRAM)\s*$/i,''))
  const step=/^\(passo\s*\d+\)\s*(\d+(?:[,.]\d+)?\s*(?:ml|g|kg|l))?/i.exec(current)
  if(step) {
    for (let j=index-1;j>=Math.max(0,index-3);j--) {
      const candidate=text(lines[j])
      if(!isNonTitle(candidate)&&/[a-záàãâéêíóôõúç]/i.test(candidate))
        return (candidate+' '+(step[1]||'')).trim().slice(0,180)
    }
  }
  if (!isNonTitle(current) && /[a-záàãâéêíóôõúç]/i.test(current)) return current.slice(0, 180)
  for (let j = index - 1; j >= Math.max(0, after); j -= 1) {
    const candidate = text(lines[j]).replace(/@[\w.-]{2,100}\b/gi,'').trim()
    if (!isNonTitle(candidate) && /[a-záàãâéêíóôõúç]/i.test(candidate)) return candidate.slice(0, 180)
  }
  return ''
}

function pageCandidates(pageText, page) {
  const lines = String(pageText || '').split('\n').map(text).filter(Boolean).slice(0, 600)
  const joined=lines.join(' ')
  // In uniform/polo lookbooks the model is the product; embroidery, patch,
  // personalised names and sleeve surcharges are options, not standalone SKUs.
  const poloName=/(?:Camiseta\s+)?POLO\s+(?:DRY|BABYLOOK|V)(?=POLO\b|\b)|POLO\s+ESTILOS\s+(?:HORIZONTAL|TRADICIONAL|LATERAL)/i.exec(joined)?.[0]||''
  const result = []
  let lastPriceIndex = -1
  for (let i = 0; i < lines.length && result.length < MAX_PRODUCTS; i += 1) {
    const price = priceFromLine(lines[i])
    if (price == null) continue
    if (poloName && /(?:nome\s+personalizado|patch\s+bordado\s+sublimado|manga\s+longa|personalizado\s+em\s+DTF)/i.test(lines[i])) continue
    // A single product can show atacado, varejo and promotional prices in adjacent lines.
    if (lastPriceIndex >= 0 && i - lastPriceIndex <= 2 && result.length && !titleFor(lines, i, lastPriceIndex + 1)) continue
    const isolatedPrice=/^\s*(?:(?:R\$\s*)?\d{1,6}(?:\.\d{3})*,\d{2}|R\$\s*)\s*$/i.test(lines[i])
    const name = poloName && (isolatedPrice||price>=25) ? poloName.replace(/(DRY|BABYLOOK|V)POLO\b/i,'$1').replace(/\s+/g,' ').trim() :
      titleFor(lines, i, Math.max(lastPriceIndex + 1, i - 4))
    if (!name) continue
    const surrounding = lines.slice(Math.max(lastPriceIndex + 1, i - 4), Math.min(i + 3, lines.length)).join(' ')
    const sku = referenceFrom(surrounding)
    const lookAhead = lines.slice(i + 1, Math.min(i + 4, lines.length)).filter((line) => !priceFromLine(line) && !isNonTitle(line))
    result.push({
      title: name,
      description: lookAhead.join(' ').slice(0, 2000),
      sku,
      category: inferPdfProductCategory(name),
      price,
      currency: 'BRL',
      images: [],
      properties: [],
      variants: [],
      source: 'pdf',
      source_url: 'pdf://page/' + page + '/item/' + result.length,
      external_id: 'pdf-p' + page + '-' + result.length,
      pdf_page: page,
    })
    lastPriceIndex = i
  }
  return result
}

/**
 * Conservative extraction: price-based product blocks, no invented missing prices.
 * The user reviews every candidate before publication.
 */
export function parsePdfCatalogText(pdfText, maxPages = MAX_PDF_PAGES) {
  const pages = String(pdfText || '').replace(/\r/g, '').split('\f').slice(0, maxPages)
  const lookbook = parseNumberedLookbookPages(pages, MAX_PRODUCTS)
  if (lookbook) return lookbook
  const fashion=parseFashionPhotoPages(pages,MAX_PRODUCTS)
  if (fashion) return fashion
  const candidates = []
  for (let index = 0; index < pages.length; index += 1) {
    const products = pageCandidates(pages[index], index + 1)
    candidates.push(...products.slice(0, Math.max(0, MAX_PRODUCTS - candidates.length)))
    if (candidates.length >= MAX_PRODUCTS) break
  }
  return { candidates, pagesScanned: pages.filter((page) => page.trim()).length }
}

function parseImageListing(list) {
  const items = []
  for (const row of String(list || '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(image|smask|mask|stencil)\s+(\d+)\s+(\d+)\s+/i.exec(row)
    if (!match) continue
    items.push({
      page: Number(match[1]),
      kind: match[3].toLowerCase(),
      width: Number(match[4]),
      height: Number(match[5]),
      index: Number(match[2]),
    })
  }
  return items
}

/**
 * prlimit execs the requested tool and imposes kernel resource quotas BEFORE
 * Poppler/Tesseract parses untrusted bytes. Do not replace with a JS-only timer:
 * a decompression bomb can exhaust native memory while JS is waiting.
 */
async function command(bin, args, timeout = 30000, deadline = Infinity) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
  try {
    const result = await run('prlimit', [...PDF_PROCESS_LIMITS, bin, ...args], {
      timeout: Math.max(1, Math.min(timeout, remaining)),
      maxBuffer: MAX_TOOL_OUTPUT_BYTES,
      killSignal: 'SIGKILL',
    })
    return result.stdout || ''
  } catch (error) {
    if (error?.killed || ['SIGXFSZ', 'SIGXCPU', 'SIGKILL'].includes(error?.signal) ||
        error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
        /(?:file size limit exceeded|cannot allocate memory|out of memory|memory allocation failed|resource temporarily unavailable)/i.test(String(error?.stderr || '') + String(error?.message || ''))) {
      throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
    }
    throw error
  }
}

export function assertPdfImageBudget(listing) {
  const images = Array.isArray(listing) ? listing : parseImageListing(listing)
  if (images.length > MAX_IMAGES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
  let totalPixels = 0
  for (const image of images) {
    const pixels = image.width * image.height
    if (!Number.isSafeInteger(pixels) || pixels <= 0 ||
        image.width > MAX_IMAGE_EDGE || image.height > MAX_IMAGE_EDGE ||
        pixels > MAX_IMAGE_PIXELS) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
    totalPixels += pixels
    if (totalPixels > MAX_TOTAL_IMAGE_PIXELS) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
  }
  return images
}

async function assertExtractedImageBudget(dir, filenames) {
  if (filenames.length > MAX_IMAGES + 5) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
  let totalBytes = 0
  for (const name of filenames) {
    if (!/^photo-\d+-\d+\.(?:jpg|jpeg|png)$/i.test(name)) continue
    const file = await stat(path.join(dir, name))
    if (!file.isFile() || file.size > MAX_GENERATED_FILE_BYTES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
    totalBytes += file.size
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
  }
}


async function attachLookbookPhotos(pdf, dir, candidates, imageListByPage, onImage, deadline, knownBbox = null) {
  // Read visual word positions from the existing PDF text layer; no OCR of pure
  // editorial photograph pages and no guessing product image associations.
  const bboxText = knownBbox ?? await command('pdftotext', ['-bbox-layout', pdf, '-'], 30000, deadline)
  const regions = parseLookbookPhotoBands(bboxText)
  const itemsByPage = new Map()
  for (const candidate of candidates) {
    if (!candidate.pdf_detail_page) continue
    const region = regions.get(candidate.pdf_detail_page + ':' + candidate.pdf_item_number)
    if (!region) continue
    if (!itemsByPage.has(region.page)) itemsByPage.set(region.page, [])
    itemsByPage.get(region.page).push({ candidate, region })
  }
  let processedPixels = 0
  let savedPhotos = 0
  for (const [page, items] of itemsByPage) {
    if (savedPhotos >= MAX_EXTRACTED_PRODUCT_PHOTOS) break
    const embedded = imageListByPage.get(page) || []
    try { assertPdfImageBudget(embedded) } catch (error) {
      if (error instanceof PdfSafetyError) continue
      throw error
    }
    // The named board is the ground-truth product image, not the preceding
    // model/editorial photo containing multiple unrelated numbered pieces.
    const prefix = path.join(dir, 'lookbook-' + page)
    const pngPath = prefix + '.png'
    try {
      await command('pdftoppm', [
        '-f', String(page), '-l', String(page), '-scale-to', '1400',
        '-singlefile', '-png', pdf, prefix,
      ], 25000, deadline)
      const source = await readFile(pngPath)
      if (source.length > MAX_GENERATED_FILE_BYTES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
      const image = sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
      const meta = await image.metadata()
      const pixels = (meta.width || 0) * (meta.height || 0)
      if (!meta.width || !meta.height || processedPixels + pixels > MAX_CUMULATIVE_EXTRACTED_PIXELS) break
      processedPixels += pixels
      for (const { candidate, region } of items) {
        if (savedPhotos >= MAX_EXTRACTED_PRODUCT_PHOTOS) break
        const y0 = Math.max(0, Math.floor(region.top / region.height * meta.height))
        const y1 = Math.min(meta.height, Math.ceil(region.bottom / region.height * meta.height))
        const x0 = Math.max(0, Math.floor((region.left || 0) / region.width * meta.width))
        const x1 = Math.min(meta.width, Math.ceil((region.right || region.width) / region.width * meta.width))
        if (y1 - y0 < 70 || x1 - x0 < 70) continue
        try {
          const photo = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS })
            .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
            .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 83 }).toBuffer()
          if (photo.length > 5 * 1024 * 1024) continue
          const uri = await onImage(photo, 'image/webp',
            'catalogo-p' + page + '-item-' + String(candidate.pdf_item_number).padStart(2, '0') + '.webp')
          if (uri) { candidate.images.push(uri); savedPhotos += 1 }
        } catch (error) {
          if (error instanceof PdfSafetyError) throw error
          console.warn('[pdf import] item photo skipped', page, candidate.pdf_item_number, error.message)
        }
      }
    } catch (error) {
      if (error instanceof PdfSafetyError) throw error
      console.warn('[pdf import] lookbook board skipped on page', page, error.message)
    } finally {
      await rm(pngPath, { force: true })
    }
  }
}

async function attachSuggestedPhotoRegions(pdf, dir, regions, onImage, deadline) {
  const byPage = new Map()
  for (const entry of regions) {
    if (entry.candidate.images?.length) continue
    const list = byPage.get(entry.page) || []
    list.push(entry); byPage.set(entry.page,list)
  }
  let saved = 0, totalPixels = 0
  for (const [page, items] of byPage) {
    if (saved >= MAX_EXTRACTED_PRODUCT_PHOTOS) break
    const prefix = path.join(dir, 'positioned-' + page)
    const file = prefix + '.png'
    try {
      await command('pdftoppm', ['-f',String(page),'-l',String(page),
        '-scale-to','1400','-singlefile','-png',pdf,prefix],25000,deadline)
      const bytes = await readFile(file)
      if (bytes.length > MAX_GENERATED_FILE_BYTES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
      const meta = await sharp(bytes,{limitInputPixels:MAX_IMAGE_PIXELS}).metadata()
      const width=meta.width||0,height=meta.height||0
      if(!width||!height||width*height>MAX_IMAGE_PIXELS||
        totalPixels+width*height>MAX_CUMULATIVE_EXTRACTED_PIXELS)break
      totalPixels+=width*height
      for(const {candidate,rect,method} of items){
        if(candidate.images?.length||saved>=MAX_EXTRACTED_PRODUCT_PHOTOS)continue
        const x0=Math.max(0,Math.floor(rect.left/rect.width*width))
        const x1=Math.min(width,Math.ceil(rect.right/rect.width*width))
        const y0=Math.max(0,Math.floor(rect.top/rect.height*height))
        const y1=Math.min(height,Math.ceil(rect.bottom/rect.height*height))
        if(x1-x0<110||y1-y0<110)continue
        try{
          const photo=await sharp(bytes,{limitInputPixels:MAX_IMAGE_PIXELS})
            .extract({left:x0,top:y0,width:x1-x0,height:y1-y0})
            .resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true})
            .webp({quality:83}).toBuffer()
          if(photo.length>5*1024*1024)continue
          const name='catalogo-p'+page+'-sugestao-'+(candidate.pdf_item_number||candidate.external_id||saved)+'.webp'
          const uri=await onImage(photo,'image/webp',name.replace(/[^a-zA-Z0-9_.-]/g,'-'))
          if(!uri)continue
          candidate.images.push(uri)
          candidate.pdf_review_required=true
          candidate.pdf_image_match_method=method
          candidate.pdf_image_source_page=page
          const message=method==='number_marker'
            ? 'REVISÃO OBRIGATÓRIA: imagem aproximada pelo marcador numérico '+candidate.pdf_item_number+' na página '+page+'; confira o enquadramento.'
            : 'REVISÃO OBRIGATÓRIA: imagem recortada pela posição do nome/preço na página '+page+'; confira o produto.'
          candidate.description=(String(candidate.description||'')+' '+message).trim().slice(0,2000)
          saved+=1
        }catch(error){
          if(error instanceof PdfSafetyError)throw error
          console.warn('[pdf import] suggested crop skipped',page,error.message)
        }
      }
    }catch(error){
      if(error instanceof PdfSafetyError)throw error
      console.warn('[pdf import] positioned photo page skipped',page,error.message)
    }finally{await rm(file,{force:true})}
  }
}

export async function collectPdfCatalog(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_PDF_BYTES ||
      !buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('Envie um PDF válido de até 100 MB.')
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shopvax-pdf-'))
  const pdf = path.join(dir, 'catalogo.pdf')
  const deadline = Date.now() + MAX_PDF_PROCESSING_MS
  try {
    await writeFile(pdf, buffer, { mode: 0o600 })
    const info = await command('pdfinfo', [pdf], 12000, deadline)
    const totalPages = Number(/^Pages:\s*(\d+)/mi.exec(info)?.[1] || 0)
    if (!totalPages) {
      throw new Error('Não foi possível identificar as páginas do PDF. Confira se o arquivo está íntegro e não possui senha.')
    }
    if (totalPages > MAX_PDF_PAGES) {
      throw new Error('Este catálogo tem ' + totalPages + ' páginas; o limite é ' + MAX_PDF_PAGES + ' páginas por PDF.')
    }
    await options.onProgress?.({ progress: 10, pagesScanned: 0, platform: 'pdf' })
    let raw = await command('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], 40000, deadline)
    const pages = raw.replace(/\r/g, '').split('\f').slice(0, totalPages)

    // OCR is a fallback only for pages without a usable text layer.
    // This class of Canva catalog mixes text pages (with name/price) and
    // image-only facing pages: running OCR on dozens of pure photo pages
    // wastes minutes and may hit the processing deadline. A full scan with
    // no detected text products STILL goes through OCR on every page.
    const textLayerParsed = parsePdfCatalogText(pages.join('\f'), totalPages)
    const textLayerCandidates = textLayerParsed.candidates.length
    const namedTextCandidates = parseNamedUnpricedPdfProducts(pages, MAX_PRODUCTS).length
    const mixedTextAndPhotoCatalog = Boolean(textLayerParsed.lookbook) || (textLayerCandidates >= 8 && totalPages >= 30) || (namedTextCandidates >= 4 && totalPages >= 20)
    let textLayerOcrAttempts = 0
    const spatialCandidatesByPage = new Map()
    for (let i = 0; i < totalPages; i += 1) {
      if (mixedTextAndPhotoCatalog && !(pages[i] || '').trim()) {
        await options.onProgress?.({ progress: Math.min(65, 12 + Math.round(50 * (i + 1) / totalPages)), pagesScanned: i + 1, platform: 'pdf' })
        continue
      }
      // Item numbers and prices are already machine-readable, even when a short
      // lookbook page has fewer than 20 alphanumeric characters. OCR could
      // misread R$ or change a verified price and must not overwrite it.
      const hasReadableText=(pages[i] || '').replace(/\W/g, '').length >= 20 || /\bR\$\s*\d/.test(pages[i] || '')
      if (hasReadableText) {
        // A text layer may contain headers only, while product prices are
        // embedded in images. Recheck a bounded number of likely product
        // pages with OCR, but never re-OCR fully parsed editorial catalogs.
        if (textLayerCandidates>0 || textLayerOcrAttempts>=12 ||
            !/(?:ref(?:er[eê]ncia)?|sku|vestido|blusa|camisa|cal[cç]a|conjunto|brinco|bolsa|produto|pre[cç]o)/i.test(pages[i] || '')) continue
        textLayerOcrAttempts += 1
      }
      const prefix = path.join(dir, 'ocr-' + i)
      try {
        await command('pdftoppm', ['-f', String(i + 1), '-l', String(i + 1), '-scale-to', '1600', '-singlefile', '-gray', '-png', pdf, prefix], 25000, deadline)
        const tsv = await command('tesseract', [prefix + '.png', 'stdout', '-l', 'por+eng', 'tsv'], 18000, deadline)
        const layout = parseTesseractTsv(tsv)
        let fallback = layout.text
        // Tesseract provides positioned word boxes in TSV, without loading
        // any separate deep-learning model or making another HTTP request.
        const textLayerItems = parsePdfCatalogText(pages[i] || '').candidates.length
        if (textLayerItems === 0 && layout.lines.length) {
          const grouped = associateOcrProducts(layout, i + 1)
          if (grouped.length) spatialCandidatesByPage.set(i + 1, grouped)
        }
        if (fallback) console.info('[pdf import] OCR page', i + 1, 'via Tesseract TSV')
        // OCR mistakes such as R$ 1300 / R$ 12,0 must never reach the
        // generic PDF parser as unambiguous 1300.00 / 12.00 prices.
        fallback = sanitizeAmbiguousOcrPrices(fallback)
        if (fallback.trim()) {
          const existingText = pages[i] || ''
          const originalMatches = parsePdfCatalogText(existingText).candidates.length
          const ocrMatches = parsePdfCatalogText(fallback).candidates.length
          // Never replace a reliable PDF text layer by noisier OCR output.
          // Favor OCR only when it discovers more priced products, or when
          // the PDF page truly lacked any extractable text.
          if (!existingText.trim() || ocrMatches > originalMatches) pages[i] = fallback
        }
      } catch (error) {
        if (error instanceof PdfSafetyError) throw error
        console.warn('[pdf import] OCR page skipped:', i + 1, error.message)
      } finally {
        // Never accumulate 80 rasterized pages in the temporary directory.
        await rm(prefix + '.png', { force: true })
      }
      await options.onProgress?.({ progress: Math.min(65, 12 + Math.round(50 * (i + 1) / totalPages)), pagesScanned: i + 1, platform: 'pdf' })
    }

    const parsed = parsePdfCatalogText(pages.join('\f'), totalPages)
    let candidates = [...parsed.candidates]
    // Spatial interpretation is a FALLBACK for raster/scanned pages, not a
    // replacement for native-PDF numbered lookbooks or known fashion layouts.
    if (!parsed.lookbook && !parsed.fashion && spatialCandidatesByPage.size) {
      for (const [pageNumber, grouped] of spatialCandidatesByPage) {
        const currentCount = candidates.filter((item) => item.pdf_page === pageNumber).length
        // Never drop already-recovered products for a partial OCR grouping.
        if (grouped.length < currentCount) continue
        candidates = candidates.filter((item) => item.pdf_page !== pageNumber)
        candidates.push(...grouped)
      }
      candidates.sort((a, b) => a.pdf_page - b.pdf_page ||
        String(a.external_id || '').localeCompare(String(b.external_id || '')))
      candidates = candidates.slice(0, MAX_PRODUCTS)
    }
    let positionedXml = null
    let positionedPages = new Map()
    if (!candidates.length && !parsed.lookbook && !parsed.fashion) {
      // Only recover detached price legends if the ordinary scanner found no
      // products. Two or more isolated photo numbers must corroborate a nearby
      // numbered BRL price table; otherwise leave the PDF for manual review.
      try {
        positionedXml=await command('pdftotext',['-bbox-layout',pdf,'-'],30000,deadline)
        positionedPages=parsePdfVisualGeometry(positionedXml,totalPages)
        candidates.push(...parseNumberedReferenceFallback(pages,positionedPages,MAX_PRODUCTS))
      } catch(error) {
        if(error instanceof PdfSafetyError)throw error
        console.warn('[pdf import] numbered layout fallback unavailable:',error.message)
      }
    }
    if (!candidates.length) {
      candidates.push(...parseReferenceOnlyPdfProducts(pages,MAX_PRODUCTS))
    }
    const pricedPages = new Set(candidates.map(item => item.pdf_page))
    // A supplier may describe products in a price-free brochure and supply
    // wholesale prices separately. Preserve only explicit title+pack-size
    // lines as review items, never infer prices from neighboring prose.
    for (const item of parseNamedUnpricedPdfProducts(pages,MAX_PRODUCTS)) {
      if (candidates.length>=MAX_PRODUCTS)break
      if (!pricedPages.has(item.pdf_page)) candidates.push(item)
    }
    if (!candidates.length) {
      throw new Error('Não foi possível identificar produtos neste PDF. Não foram encontrados produtos com preço, referência ou títulos e embalagens suficientemente claros. Confira a nitidez ou envie imagens para revisão.')
    }
    // Extract native PDF word coordinates only for pages with multiple items or
    // supplier-numbered lookbooks. Already verified references always take
    // precedence over any spatial heuristic.
    let priceMatches = []
    const itemsPerPage = new Map()
    for(const candidate of candidates) itemsPerPage.set(candidate.pdf_page,(itemsPerPage.get(candidate.pdf_page)||0)+1)
    if(parsed.lookbook || [...itemsPerPage.values()].some(n=>n>1)){
      try{
        if(!positionedXml){
          positionedXml=await command('pdftotext',['-bbox-layout',pdf,'-'],30000,deadline)
          positionedPages=parsePdfVisualGeometry(positionedXml,totalPages)
        }
        if(!parsed.lookbook && !parsed.fashion) priceMatches=associateNativePricesByProximity(candidates,positionedPages)
      }catch(error){
        if(error instanceof PdfSafetyError)throw error
        console.warn('[pdf import] position analysis unavailable:',error.message)
      }
    }


    // Preserve product names/prices even when a long Canva export embeds many
    // masks, icons and background images. Inspect the listing first, then
    // extract ONE PAGE at a time: never decompress the whole catalog.
    // One candidate per page is required to avoid assigning a wrong photo.
    if (options.onImage) {
      try {
        // Lookbooks are rendered from page-specific product boards. They may
        // contain thousands of embedded decorative masks, which make an entire
        // document pdfimages listing both slow and unnecessary.
        const listing = parsed.lookbook ? [] : parseImageListing(await command('pdfimages', ['-list', pdf], 16000, deadline))
        if (listing.length > MAX_IMAGE_LIST_ENTRIES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
        const pageCounts = new Map()
        for (const item of candidates) pageCounts.set(item.pdf_page, (pageCounts.get(item.pdf_page) || 0) + 1)
        const byPage = new Map()
        for (const item of listing) {
          if (!byPage.has(item.page)) byPage.set(item.page, [])
          byPage.get(item.page).push(item)
        }
        if (parsed.lookbook) {
          await attachLookbookPhotos(pdf, dir, candidates, byPage, options.onImage, deadline, positionedXml)
        } else {
        let processedPixels = 0
        let savedPhotos = 0
        for (const candidate of candidates) {
          if (pageCounts.get(candidate.pdf_page) !== 1 || savedPhotos >= MAX_EXTRACTED_PRODUCT_PHOTOS) continue
          // Canva and other fashion catalogs often put additional angles of
          // the same product on the following image-only pages (Look Premium:
          // 75 price pages in a 166-page PDF). Never borrow an image from a
          // page containing another product or other readable text.
          const photoPages = [candidate.pdf_page]
          for (let next = candidate.pdf_page + 1; !candidate.pdf_fashion_lookbook &&
            next <= totalPages && photoPages.length < MAX_PHOTO_PAGES_PER_PRODUCT; next += 1) {
            if (pageCounts.has(next) || (pages[next - 1] || '').trim()) break
            photoPages.push(next)
          }
          for (const page of photoPages) {
            if (savedPhotos >= MAX_EXTRACTED_PRODUCT_PHOTOS) break
            const pageImages = byPage.get(page) || []
            // Suspicious page images are skipped rather than rendered, while
            // readable product text can still be staged for human review.
            try { assertPdfImageBudget(pageImages) } catch (error) {
              if (error instanceof PdfSafetyError) continue
              throw error
            }
            const photo = pageImages
              .filter((item) => item.kind === 'image' && item.width >= 220 && item.height >= 220)
              .sort((a, b) => b.width * b.height - a.width * a.height)[0]
            if (!photo) continue
            const pixels = photo.width * photo.height
            if (processedPixels + pixels > MAX_CUMULATIVE_EXTRACTED_PIXELS) break
            processedPixels += pixels
            const prefix = path.join(dir, 'photo-' + page)
            try {
              await command('pdfimages', ['-f', String(page), '-l', String(page), '-j', '-png', pdf, prefix], 25000, deadline)
              const files = (await readdir(dir)).filter((name) =>
                new RegExp('^photo-' + page + '-\\d+\\.(?:jpg|jpeg|png)$', 'i').test(name))
              await assertExtractedImageBudget(dir, files)
              // pdfimages -list counts images globally in a full-document
              // listing. pdfimages -f/-l extraction RESTARTS numbering at
              // zero for the selected page. The old code matched the global
              // index to local filenames, losing almost every product image.
              const localIndex = photo.index - (pageImages[0]?.index ?? 0)
              const photoFile = files.find((file) =>
                Number(/-([0-9]+)[.](?:jpg|jpeg|png)$/i.exec(file)?.[1]) === localIndex)
              if (!photoFile) continue
              const buffer = await readFile(path.join(dir, photoFile))
              if (buffer.length > MAX_GENERATED_FILE_BYTES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
              const image = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
                .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 82 }).toBuffer()
              if (image.length > 5 * 1024 * 1024) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
              const url = await options.onImage(image, 'image/webp', 'catalogo-p' + page + '.webp')
              if (url) {
                candidate.images.push(url)
                savedPhotos += 1
              }
            } catch (error) {
              if (error instanceof PdfSafetyError) throw error
              console.warn('[pdf import] photo skipped on page', page, error.message)
            } finally {
              // Each page's temporary images are discarded before moving on.
              const found = (await readdir(dir)).filter((name) =>
                new RegExp('^photo-' + page + '-\\d+\\.(?:jpg|jpeg|png)$', 'i').test(name))
              await Promise.all(found.map((name) => rm(path.join(dir, name), { force: true })))
            }
          }
        }
        }
        // A lookbook's price list is linked by its exact printed item number,
        // while independent multi-product pages use same-page spatial crops.
        const visualRegions = [
          ...numberedPhotoRegions(candidates, positionedPages, parsed.lookbook ? null : byPage),
          ...(!parsed.lookbook ? proximityPhotoRegions(priceMatches, positionedPages, byPage) : []),
        ]
        if(visualRegions.length) {
          await attachSuggestedPhotoRegions(pdf,dir,visualRegions,options.onImage,deadline)
          console.info('[pdf import] visual associations',visualRegions.length)
        }
      } catch (error) {
        if (error instanceof PdfSafetyError) throw error
        console.warn('[pdf import] PDF pictures unavailable:', error.message)
      }
    }

    await options.onProgress?.({ progress: 95, pagesScanned: totalPages, candidates: candidates.length, platform: 'pdf' })
    return { candidates, pagesScanned: totalPages, platform: 'pdf' }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
