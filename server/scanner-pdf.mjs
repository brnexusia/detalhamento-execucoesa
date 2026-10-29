import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import sharp from 'sharp'

const run = promisify(execFile)
export const MAX_PDF_BYTES = 16 * 1024 * 1024
export const MAX_PDF_PAGES = 80
const MAX_PRODUCTS = 500
const MAX_IMAGES = 220

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
    const match = /^\s*(\d+)\s+\d+\s+(image|smask|mask|stencil)\s+(\d+)\s+(\d+)\s+/i.exec(row)
    if (!match) continue
    items.push({
      page: Number(match[1]),
      kind: match[2].toLowerCase(),
      width: Number(match[3]),
      height: Number(match[4]),
      index: items.length,
    })
  }
  return items
}

async function command(bin, args, timeout = 30000) {
  const result = await run(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 })
  return result.stdout || ''
}

export async function collectPdfCatalog(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_PDF_BYTES ||
      !buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
    throw new Error('Envie um PDF válido de até 16 MB.')
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shopvax-pdf-'))
  const pdf = path.join(dir, 'catalogo.pdf')
  try {
    await writeFile(pdf, buffer, { mode: 0o600 })
    const info = await command('pdfinfo', [pdf], 12000)
    const totalPages = Number(/^Pages:\s*(\d+)/mi.exec(info)?.[1] || 0)
    if (!totalPages || totalPages > MAX_PDF_PAGES) {
      throw new Error('O catálogo PDF deve ter de 1 a ' + MAX_PDF_PAGES + ' páginas.')
    }
    await options.onProgress?.({ progress: 10, pagesScanned: 0, platform: 'pdf' })
    let raw = await command('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], 40000)
    const pages = raw.replace(/\r/g, '').split('\f').slice(0, totalPages)

    // OCR is a fallback only for pages without a usable text layer.
    for (let i = 0; i < totalPages; i += 1) {
      if ((pages[i] || '').replace(/\W/g, '').length >= 20) continue
      const prefix = path.join(dir, 'ocr-' + i)
      try {
        await command('pdftoppm', ['-f', String(i + 1), '-l', String(i + 1), '-scale-to', '1600', '-singlefile', '-gray', '-png', pdf, prefix], 25000)
        const fallback = await command('tesseract', [prefix + '.png', 'stdout', '-l', 'por+eng'], 18000)
        if (fallback.trim()) pages[i] = fallback
      } catch (error) {
        console.warn('[pdf import] OCR page skipped:', i + 1, error.message)
      }
      await options.onProgress?.({ progress: Math.min(65, 12 + Math.round(50 * (i + 1) / totalPages)), pagesScanned: i + 1, platform: 'pdf' })
    }

    const parsed = parsePdfCatalogText(pages.join('\f'), totalPages)
    const candidates = parsed.candidates
    if (!candidates.length) {
      throw new Error('Nenhum produto com nome e preço reconhecíveis foi encontrado. Use um PDF com preços legíveis ou cadastre os produtos manualmente.')
    }

    // Only link embedded photos when a page has exactly one candidate.
    // This avoids assigning the wrong image to a product in grid-style PDFs.
    if (options.onImage) {
      try {
        const listing = parseImageListing(await command('pdfimages', ['-list', pdf], 16000))
        if (listing.length <= MAX_IMAGES) {
          const eligible = new Set()
          const byPage = new Map()
          for (const item of candidates) byPage.set(item.pdf_page, (byPage.get(item.pdf_page) || 0) + 1)
          for (const [page, count] of byPage.entries()) if (count === 1) eligible.add(page)
          if (listing.some((item) => eligible.has(item.page) && item.kind === 'image' && item.width >= 220 && item.height >= 220)) {
            const prefix = path.join(dir, 'photo')
            await command('pdfimages', ['-j', '-png', pdf, prefix], 60000)
            const files = await readdir(dir)
            const media = new Map()
            for (const file of files) {
              const match = /^photo-(\d+)\.(?:jpg|jpeg|png)$/i.exec(file)
              if (match) media.set(Number(match[1]), file)
            }
            for (const candidate of candidates) {
              if (!eligible.has(candidate.pdf_page)) continue
              const photos = listing.filter((item) =>
                item.page === candidate.pdf_page && item.kind === 'image' && item.width >= 220 && item.height >= 220
              ).sort((a, b) => (b.width * b.height) - (a.width * a.height)).slice(0, 3)
              const hashes = new Set()
              for (const photo of photos) {
                const file = media.get(photo.index)
                if (!file) continue
                try {
                  const image = await sharp(await readFile(path.join(dir, file)), { limitInputPixels: 35_000_000 })
                    .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 82 }).toBuffer()
                  const hash = crypto.createHash('sha256').update(image).digest('hex')
                  if (hashes.has(hash)) continue
                  hashes.add(hash)
                  const url = await options.onImage(image, 'image/webp', 'catalogo-p' + candidate.pdf_page + '.webp')
                  if (url) candidate.images.push(url)
                } catch (error) {
                  console.warn('[pdf import] image skipped:', error.message)
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn('[pdf import] PDF pictures unavailable:', error.message)
      }
    }

    await options.onProgress?.({ progress: 95, pagesScanned: totalPages, candidates: candidates.length, platform: 'pdf' })
    return { candidates, pagesScanned: totalPages, platform: 'pdf' }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
