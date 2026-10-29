import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import sharp from 'sharp'

const run = promisify(execFile)
export const MAX_PDF_BYTES = 50 * 1024 * 1024
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
const MAX_EXTRACTED_PRODUCT_PHOTOS = 90
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
  const matches = [...String(line).matchAll(/(?:R\$\s*|(?:pre[cç]o|atacado|varejo|valor)\s*(?:de|:|-)?\s*)(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}(?:\.\d{3})*)/gi)]
  if (!matches.length) return null
  const prices = matches.map((match) => {
    const value = match[1].replace(/\./g, '').replace(',', '.')
    return Number(value)
  }).filter((value) => value > 0 && value <= 1000000)
  return prices.length ? Math.min(...prices) : null
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
  const current = text(lines[index].replace(/(?:R\$\s*|(?:pre[cç]o|atacado|varejo|valor)\s*(?:de|:|-)?\s*)\d{1,6}(?:\.\d{3})*(?:,\d{2})?/gi, ''))
  if (!isNonTitle(current) && /[a-záàãâéêíóôõúç]/i.test(current)) return current.slice(0, 180)
  for (let j = index - 1; j >= Math.max(0, after); j -= 1) {
    const candidate = text(lines[j])
    if (!isNonTitle(candidate) && /[a-záàãâéêíóôõúç]/i.test(candidate)) return candidate.slice(0, 180)
  }
  return ''
}

function pageCandidates(pageText, page) {
  const lines = String(pageText || '').split('\n').map(text).filter(Boolean).slice(0, 600)
  const result = []
  let lastPriceIndex = -1
  for (let i = 0; i < lines.length && result.length < MAX_PRODUCTS; i += 1) {
    const price = priceFromLine(lines[i])
    if (price == null) continue
    // A single product can show atacado, varejo and promotional prices in adjacent lines.
    if (lastPriceIndex >= 0 && i - lastPriceIndex <= 2 && result.length && !titleFor(lines, i, lastPriceIndex + 1)) continue
    const name = titleFor(lines, i, Math.max(lastPriceIndex + 1, i - 4))
    if (!name) continue
    const surrounding = lines.slice(Math.max(lastPriceIndex + 1, i - 4), Math.min(i + 3, lines.length)).join(' ')
    const sku = referenceFrom(surrounding)
    const lookAhead = lines.slice(i + 1, Math.min(i + 4, lines.length)).filter((line) => !priceFromLine(line) && !isNonTitle(line))
    result.push({
      title: name,
      description: lookAhead.join(' ').slice(0, 2000),
      sku,
      category: 'Geral',
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

export async function collectPdfCatalog(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_PDF_BYTES ||
      !buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('Envie um PDF válido de até 50 MB.')
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
    for (let i = 0; i < totalPages; i += 1) {
      if ((pages[i] || '').replace(/\W/g, '').length >= 20) continue
      const prefix = path.join(dir, 'ocr-' + i)
      try {
        await command('pdftoppm', ['-f', String(i + 1), '-l', String(i + 1), '-scale-to', '1600', '-singlefile', '-gray', '-png', pdf, prefix], 25000, deadline)
        const fallback = await command('tesseract', [prefix + '.png', 'stdout', '-l', 'por+eng'], 18000, deadline)
        if (fallback.trim()) pages[i] = fallback
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
    const candidates = parsed.candidates
    if (!candidates.length) {
      throw new Error('Nenhum produto com nome e preço reconhecíveis foi encontrado. Use um PDF com preços legíveis ou cadastre os produtos manualmente.')
    }

    // Preserve product names/prices even when a long Canva export embeds many
    // masks, icons and background images. Inspect the listing first, then
    // extract ONE PAGE at a time: never decompress the whole catalog.
    // One candidate per page is required to avoid assigning a wrong photo.
    if (options.onImage) {
      try {
        const listing = parseImageListing(await command('pdfimages', ['-list', pdf], 16000, deadline))
        if (listing.length > MAX_IMAGE_LIST_ENTRIES) throw new PdfSafetyError(UNSAFE_PDF_MESSAGE)
        const pageCounts = new Map()
        for (const item of candidates) pageCounts.set(item.pdf_page, (pageCounts.get(item.pdf_page) || 0) + 1)
        const byPage = new Map()
        for (const item of listing) {
          if (!byPage.has(item.page)) byPage.set(item.page, [])
          byPage.get(item.page).push(item)
        }
        let processedPixels = 0
        let savedPhotos = 0
        for (const candidate of candidates) {
          if (pageCounts.get(candidate.pdf_page) !== 1 || savedPhotos >= MAX_EXTRACTED_PRODUCT_PHOTOS) continue
          const pageImages = byPage.get(candidate.pdf_page) || []
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
          if (processedPixels + pixels > MAX_TOTAL_IMAGE_PIXELS) break
          processedPixels += pixels
          const page = candidate.pdf_page
          const prefix = path.join(dir, 'photo-' + page)
          let files = []
          try {
            await command('pdfimages', ['-f', String(page), '-l', String(page), '-j', '-png', pdf, prefix], 25000, deadline)
            files = (await readdir(dir)).filter((name) =>
              new RegExp('^photo-' + page + '-\\d+\\.(?:jpg|jpeg|png)$', 'i').test(name))
            await assertExtractedImageBudget(dir, files)
            const photoFile = files.find((file) =>
              Number(/-(\d+)\.(?:jpg|jpeg|png)$/i.exec(file)?.[1]) === photo.index)
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
            // No image file survives the current page. Disk use does not grow
            // in proportion to the number of pages in the PDF.
            const found = (await readdir(dir)).filter((name) =>
              new RegExp('^photo-' + page + '-\\d+\\.(?:jpg|jpeg|png)$', 'i').test(name))
            await Promise.all(found.map((name) => rm(path.join(dir, name), { force: true })))
          }
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
