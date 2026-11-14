import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { parseTesseractTsv } from './scanner-pdf-tesseract.mjs'

// Uses the Tesseract (por+eng) already installed in the production image.
// OCR reads only the merchant's supplied image; never downloads arbitrary
// second-party assets or sends photos to an external AI service.
const OCR_TIMEOUT_MS = 9_000
const MAX_OCR_OUTPUT = 256 * 1024
const PRICE_MARKED = /(?:R\s*[$S§]|BRL\b|PRE[CÇ]O\b|VALOR\b)\s*[:=\-]?\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}\.\d{2})/giu
const QUANTITY = /(?:^|[\s(])(\d{1,4})\s*(P\s*[ÇC]S?|PE[ÇC]AS?|UNIDADES?|UNID\.?|UND\.?|PARES?|PAR|KITS?|D[UÚ]ZIAS?|DZ)(?=$|[\s,.;:)\]]|R\s*\$)/iu
const PRODUCT_WORD = /^(?:BRINCO|BRINCOS|COLAR|COLARES|ANEL|ANEIS|ANÉIS|PULSEIRA|PULSEIRAS|CONJUNTO|CONJUNTOS|CHOKER|TORNOZELEIRA|TORNOZELEIRAS|BRACELETE|BRACELETES|TIARA|TIARAS|PRESILHA|PRESILHAS|BOLSA|BOLSAS|ARCO|ARCOS|KIT|LA[CÇ]O|LA[CÇ]OS|PIERCING|GARGANTILHA|GARGANTILHAS|PINGENTE|PINGENTES|ACESS[OÓ]RIO|ACESS[OÓ]RIOS)\b/iu

function lineText(raw) {
  return String(raw ?? '').normalize('NFKC')
    .replace(/[\u200b-\u200f\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ').trim()
}

function priceOf(value) {
  const raw = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
  const number = Number(raw)
  return Number.isFinite(number) && number > 0 && number <= 100000 ? Math.round(number * 100) / 100 : null
}

function labelName(lines, priceIndex) {
  const relevant = priceIndex >= 0
    ? lines.slice(Math.max(0, priceIndex - 4), priceIndex + 1)
    : lines.slice(0, 4)
  const names = relevant.map(line => line
    .replace(/(?:R\s*[$S§]|BRL\b|PRE[CÇ]O\b|VALOR\b)\s*[:=\-]?\s*\d{1,6}(?:\.\d{3})*[,.]\d{2}/giu, '')
    .replace(QUANTITY, ' ')
    .replace(/\b(?:REF(?:ER[EÊ]NCIA)?|COD(?:IGO)?|SKU)\s*[:#.\-]\s*[A-Z0-9\-\/]+\b/giu, '')
    .replace(/^[\s|:;,.!#-]+|[\s|:;,.!#-]+$/g, '')
    .replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 1 &&
      /[\p{L}]/u.test(x) &&
      !/^(?:MAMA|BIJOUX|INSTAGRAM|CAT[AÁ]LOGO|NOVIDADES|PRE[CÇ]O|ATACADO|VAREJO|QUANTIDADE|REF|SKU|R\s*\$)$/iu.test(x) &&
      !/^(?:\d+|[\d\s.,\-/]+)$/u.test(x))
  if (!names.length) return ''
  // Requiring an item-type word prevents unrelated image text or logos from
  // being silently inserted as the product name.
  const start = names.findIndex(x => PRODUCT_WORD.test(x))
  if (start < 0) return ''
  // OCR may append tiny fragments from the photographed jewelry itself:
  // "BRINCO ‘the", "BRINCO ait 1 PG", etc. Keep the actual product word,
  // not those meaningless fragments or misread quantity glyphs.
  const connectors = new Set(['de','da','do','das','dos','com','sem','em','e','as','os','um','uma'])
  const pieces = []
  for (const line of names.slice(start, start + 3)) {
    const tokens = line.match(/\p{L}+|\d+/gu) || []
    for (const token of tokens) {
      const key = token.toLocaleLowerCase('pt-BR')
      if (/^\d+$/.test(token) || (token.length < 4 && !connectors.has(key) &&
          !new Set(['aço','aco','kit','sol','lua','mar']).has(key) && !PRODUCT_WORD.test(token))) break
      pieces.push(token)
    }
  }
  while (pieces.length > 1 && connectors.has(pieces.at(-1).toLocaleLowerCase('pt-BR'))) pieces.pop()
  const value = pieces.join(' ').trim().slice(0, 180)
  if (value.length < 4 || value.length > 150) return ''
  if (value === value.toLocaleUpperCase('pt-BR')) {
    return value.toLocaleLowerCase('pt-BR').replace(/(^|[\s/-])(\p{L})/gu, (_m, sep, letter) =>
      sep + letter.toLocaleUpperCase('pt-BR'))
  }
  return value
}

export function parsePhotoProductLabel(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map(lineText).filter(Boolean).slice(0, 30)
  const all = lines.join('\n')
  const occurrences = [...all.matchAll(PRICE_MARKED)].map(x => priceOf(x[1])).filter(x => x !== null)
  const prices = [...new Set(occurrences)]
  // Competing price labels (e.g. retail versus wholesale) must not be guessed.
  const price = prices.length === 1 ? prices[0] : null
  const priceIndex = lines.findIndex(x => [...x.matchAll(PRICE_MARKED)].length > 0)
  const quantityMatch = QUANTITY.exec(all)
  const quantity = quantityMatch && Number(quantityMatch[1]) > 0 ? Number(quantityMatch[1]) : null
  const unit = quantityMatch?.[2] || ''
  const pack = quantity === null ? '' :
    quantity + ' ' + (/PAR/i.test(unit) ? (quantity === 1 ? 'par' : 'pares') :
      /KIT/i.test(unit) ? (quantity === 1 ? 'kit' : 'kits') :
      /DZ|D[UÚ]Z/i.test(unit) ? (quantity === 1 ? 'dúzia' : 'dúzias') :
      (quantity === 1 ? 'peça' : 'peças'))
  return {
    title: labelName(lines, priceIndex),
    price,
    pack,
  }
}

function ocrTsv(buffer, psm = 6) {
  return new Promise((resolve, reject) => {
    const child = spawn('prlimit', [
      '--as=1073741824', '--cpu=12', '--fsize=10485760', '--',
      'tesseract', 'stdin', 'stdout', '-l', 'por+eng', '--psm', String(psm), 'tsv',
    ], { stdio:['pipe','pipe','pipe'] })
    const chunks = []
    let length = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), OCR_TIMEOUT_MS)
    let stderr = ''
    child.stdout.on('data', chunk => {
      length += chunk.length
      if (length > MAX_OCR_OUTPUT) { child.kill('SIGKILL'); return }
      chunks.push(chunk)
    })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-600) })
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || length > MAX_OCR_OUTPUT) {
        reject(new Error('OCR indisponível ou excedeu limite seguro.'))
        return
      }
      try { resolve(parseTesseractTsv(Buffer.concat(chunks).toString('utf8'))) }
      catch (err) { reject(err) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(buffer)
  })
}

export async function recognizePhotoProductLabel(imageBytes, { ocr = ocrTsv } = {}) {
  try {
    if (!Buffer.isBuffer(imageBytes) || imageBytes.length > 8 * 1024 * 1024) return null
    const meta = await sharp(imageBytes, {limitInputPixels:40_000_000}).metadata()
    const width = Number(meta.width || 0), height = Number(meta.height || 0)
    if (width < 220 || height < 220) return null
    // Labels in jewelry lookbooks are typically in the upper-left corner.
    // First crop avoids hallucinating text from the actual product photograph.
    const crop = await sharp(imageBytes, {limitInputPixels:40_000_000})
      .extract({
        left:0, top:0,
        width:Math.min(width, Math.ceil(width * 0.55)),
        height:Math.min(height, Math.ceil(height * 0.20)),
      })
      // Small price labels need upscaling for punctuation (R$ 7,00 vs R$ 700).
      // Previous withoutEnlargement:true kept 330px crops tiny and lost commas.
      .resize({width:1200,kernel:'lanczos3'})
      .grayscale().normalize().png().toBuffer()
    const first = parsePhotoProductLabel((await ocr(crop, 11)).text)
    if (first.title && first.price !== null) return first
    // Additional fallback for labels outside the crop or split lines.
    const image = await sharp(imageBytes, {limitInputPixels:40_000_000})
      .resize({width:1600,withoutEnlargement:true}).png().toBuffer()
    const second = parsePhotoProductLabel((await ocr(image, 11)).text)
    return {
      title: first.title || second.title,
      price: first.price ?? second.price,
      pack: first.pack || second.pack,
    }
  } catch {
    // OCR failure must never prevent downloading or reviewing a public photo.
    return null
  }
}
