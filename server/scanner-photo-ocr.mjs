import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { parseTesseractTsv } from './scanner-pdf-tesseract.mjs'

// Uses the Tesseract (por+eng) already installed in the production image.
// OCR reads only the merchant's supplied image; never downloads arbitrary
// second-party assets or sends photos to an external AI service.
const OCR_TIMEOUT_MS = 9_000
const MAX_OCR_OUTPUT = 256 * 1024
const PRICE_MARKED = /(?:R\s*[$S§]|BRL\b|PRE[CÇ]O\b|VALOR\b)\s*[:=\-]?\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}\.\d{2})/giu
// OCR commonly reads '1 PÇ' as 'IPC', 'IPG' or '1P¢' on small tags.
// Accept these glyphs ONLY immediately before a monetary value with cents.
const ONE_PIECE_PRICE = /(?:^|[^\p{L}\d])[1I|l]\s*(?:P\s*[ÇCG¢]S?|PE[ÇC]AS?|PAR|UN(?:D(?:IDADE)?S?)?)\s*[:=\-]?\s*(?:R\s*[$S§]|BRL\b)\s*[:=\-]?\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}\.\d{2})/giu
// The identifier must be printed explicitly on the label; a random photo index is never a SKU.
// Require at least one digit to avoid turning ordinary product text into an identifier.
const SKU_MARKED = /(?:^|[\s,;|])(?:SKU|REF(?:ER[ÊE]NCIA)?|C[ÓO]D(?:IGO)?)\s*(?::|#|\.|-|\s)\s*([A-Z0-9][A-Z0-9/_-]{2,48})(?=$|[\s;,.])/giu
const DOZEN_PRICE = /(?:^|[^\p{L}\d])(?:DZ|D[UÚ]ZIAS?|DE)\s*[:=\-]?\s*(?:R\s*[$S§]|BRL\b)\s*[:=\-]?\s*(\d{1,6}(?:\.\d{3})*,\d{2}|\d{1,6}\.\d{2})/giu
const QUANTITY = /(?:^|[\s(])(\d{1,4}|[I|l])\s*(P\s*[ÇCG¢]S?|PE[ÇC]AS?|UNIDADES?|UNID\.?|UND\.?|PARES?|PAR|KITS?|D[UÚ]ZIAS?|DZ)(?=$|[\s,.;:)\]]|R\s*\$)/iu
const PRODUCT_WORD = /^(?:BRINCO|BRINCOS|COLAR|COLARES|ANEL|ANEIS|ANÉIS|PULSEIRA|PULSEIRAS|CONJUNTO|CONJUNTOS|CHOKER|TORNOZELEIRA|TORNOZELEIRAS|BRACELETE|BRACELETES|TIARA|TIARAS|PRESILHA|PRESILHAS|BOLSA|BOLSAS|ARCO|ARCOS|KIT|LA[CÇ]O|LA[CÇ]OS|PIERCING|GARGANTILHA|GARGANTILHAS|PINGENTE|PINGENTES|ACESS[OÓ]RIO|ACESS[OÓ]RIOS|LEN[CÇ]O|LEN[CÇ]OS|CINTO|CINTOS|BROCHE|BROCHES|CHAVEIRO|CHAVEIROS|COPO|COPOS|PORTA.J[OÓ]IAS?|NECESSAIRES?|CACHECOL|CACHEC[OÓ]IS|CAL[CÇ]A|CAL[CÇ]AS|MEIA|MEIAS|GORRO|GORROS|BICO|BLUSA|BLUSAS|CAMISA|CAMISAS|MANTA|MANTAS|ESTOJO|ESTOJOS)\b/iu

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
    .replace(SKU_MARKED, ' ')
    .replace(/\b(?:REF(?:ER[ÊE]NCIA)?|C[ÓO]D(?:IGO)?|SKU)\s*[:#.\-]?(?=$|\s)/giu, ' ')
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
  // A sticker may show a price for 1 piece and a different price per dozen:
  // "1 PÇ R$ 20,00 / DZ R$ 220,00". Treat that as ONE unit price.
  // Two different "1 PÇ" prices (two different items in the photo) remain
  // ambiguous and require manual review.
  const piecePrices = [...new Set(lines.flatMap(line =>
    [...line.matchAll(ONE_PIECE_PRICE)].map(hit => priceOf(hit[1])).filter(x => x !== null)))]
  // Never assign a standalone dozen price to the unit product when the
  // '1 PÇ' row is unreadable. This would overprice the product dramatically.
  const dozenPrices = [...new Set(lines.flatMap(line =>
    [...line.matchAll(DOZEN_PRICE)].map(hit => priceOf(hit[1])).filter(x => x !== null)))]
  const price = piecePrices.length > 1 ? null :
    piecePrices.length === 1 ? piecePrices[0] :
    prices.length === 1 && !dozenPrices.includes(prices[0]) ? prices[0] : null
  const skus = [...new Set([...all.matchAll(SKU_MARKED)].map(x => x[1].toUpperCase()).filter(x => /\d/.test(x) && x.length >= 3))]
  // Ambiguous/competing reference numbers are never assigned automatically.
  const sku = skus.length === 1 ? skus[0] : ''
  const priceIndex = lines.findIndex(x => [...x.matchAll(PRICE_MARKED)].length > 0)
  const quantityMatch = QUANTITY.exec(all)
  const rawQuantity = quantityMatch?.[1] || ''
  const quantityNumber = /^[I|l]$/i.test(rawQuantity) ? 1 : Number(rawQuantity)
  const quantity = rawQuantity && Number.isFinite(quantityNumber) && quantityNumber > 0 ? quantityNumber : null
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
    ...(sku ? { sku } : {}),
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

    // Prices printed on a small sticker in the corner are easily lost when
    // the crop includes the magazine/background next to the sticker.
    // OCR a focused top-left region first (Tesseract's page mode 3).
    // A wider crop is retained for different sticker positions.
    const attempts = [
      {leftFraction:0,topFraction:0,widthFraction:0.35,heightFraction:0.20,psm:3},
      {leftFraction:0,topFraction:0,widthFraction:0.55,heightFraction:0.20,psm:11},
      // A hard threshold can reveal printed decimal commas that grayscale
      // hides on light stickers or patterned jewelry backgrounds.
      {leftFraction:0,topFraction:0,widthFraction:0.45,heightFraction:0.25,psm:11,binary:true,targetWidth:1700},
      // Scarves, winter garments and gift sets often place their labels in
      // the middle or lower portion of the photo rather than the corner.
      {leftFraction:0.20,topFraction:0.28,widthFraction:0.70,heightFraction:0.35,psm:11},
      {leftFraction:0.10,topFraction:0.46,widthFraction:0.75,heightFraction:0.30,psm:11},
      {leftFraction:0,topFraction:0.32,widthFraction:0.60,heightFraction:0.30,psm:11},
      // Promotion stickers can sit at the very bottom right (winter scarves).
      {leftFraction:0.66,topFraction:0.73,widthFraction:0.33,heightFraction:0.25,psm:6,binary:true},
      // Second-pass sticker OCR, only when none of the 7 usual crops found
      // an explicit decimal price. In MAMA photos the 1cm label can occupy
      // fewer than 100 source pixels; PSM 6 + 1900px often restores the comma.
      {leftFraction:0,topFraction:0,widthFraction:0.35,heightFraction:0.20,psm:6,targetWidth:1900,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.45,heightFraction:0.25,psm:6,targetWidth:1900,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.32,heightFraction:0.18,psm:11,targetWidth:1900,sharpen:true,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.45,heightFraction:0.25,psm:6,targetWidth:1700,binary:true,priceRecovery:true},
      // Extra-tight crops for tiny 1 PC / R$ 17,00 stickers. Keep this as
      // a last resort only, never on images already priced by the first pass.
      {leftFraction:0,topFraction:0,widthFraction:0.25,heightFraction:0.17,psm:6,targetWidth:2300,sharpen:true,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.27,heightFraction:0.17,psm:11,targetWidth:1900,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.30,heightFraction:0.20,psm:6,targetWidth:1800,binary:true,threshold:150,priceRecovery:true},
      // Last-resort line-oriented reads: Tesseract PSM 7/13 can recover
      // comma-separated cents on very small two-line printed tags when the
      // normal sparse-text passes only recognize '700' instead of '7,00'.
      // Different tag positions are deliberately covered; any doubtful
      // number still fails the strict 'R$ nn,dd' parser.
      {leftFraction:0,topFraction:0.055,widthFraction:0.28,heightFraction:0.075,psm:7,targetWidth:2200,sharpen:true,priceRecovery:true},
      {leftFraction:0,topFraction:0.055,widthFraction:0.28,heightFraction:0.075,psm:13,targetWidth:2200,binary:true,threshold:175,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.30,heightFraction:0.14,psm:6,targetWidth:2500,sharpen:true,priceRecovery:true},
      {leftFraction:0,topFraction:0,widthFraction:0.30,heightFraction:0.14,psm:11,targetWidth:2500,binary:true,threshold:190,priceRecovery:true},
      {leftFraction:0.65,topFraction:0,widthFraction:0.35,heightFraction:0.18,psm:6,targetWidth:2000,sharpen:true,priceRecovery:true},
      {leftFraction:0.65,topFraction:0,widthFraction:0.35,heightFraction:0.18,psm:11,targetWidth:2000,binary:true,threshold:170,priceRecovery:true},
      {leftFraction:0,topFraction:0.70,widthFraction:0.36,heightFraction:0.30,psm:6,targetWidth:2000,sharpen:true,priceRecovery:true},
      {leftFraction:0,topFraction:0.70,widthFraction:0.36,heightFraction:0.30,psm:11,targetWidth:2000,binary:true,threshold:170,priceRecovery:true},
      {leftFraction:0.65,topFraction:0.70,widthFraction:0.35,heightFraction:0.30,psm:7,targetWidth:2200,binary:true,threshold:175,priceRecovery:true},
      {leftFraction:0.65,topFraction:0.70,widthFraction:0.35,heightFraction:0.30,psm:6,targetWidth:2200,sharpen:true,priceRecovery:true},
    ]
    const combined = {title:'',price:null,pack:''}
    let focusedLineRetries = 0
    const focusedLineKeys = new Set()
    for(const attempt of attempts) {
      if (attempt.priceRecovery && combined.price !== null) break
      try {
      const transform = sharp(imageBytes, {limitInputPixels:40_000_000})
        .extract({
          left:Math.floor(width*attempt.leftFraction),
          top:Math.floor(height*attempt.topFraction),
          width:Math.min(width-Math.floor(width*attempt.leftFraction),Math.ceil(width*attempt.widthFraction)),
          height:Math.min(height-Math.floor(height*attempt.topFraction),Math.ceil(height*attempt.heightFraction)),
        })
        .resize({width:attempt.targetWidth || (attempt.binary ? 1600 : 1200),kernel:'lanczos3'})
        .grayscale()
      const prepared = await (attempt.binary ? transform.threshold(attempt.threshold || 160) :
        attempt.sharpen ? transform.normalize().sharpen() : transform.normalize())
        .png().toBuffer()
      const read = await ocr(prepared,attempt.psm)
      let recognized = parsePhotoProductLabel(read.text)
      // Tesseract can read a printed "R$ 7,00" as "R$ 700" even when
      // the original photo visibly contains the comma. Crop the OCR-detected
      // monetary line itself and upscale 3x, rather than guessing decimals.
      // No coordinate data is supplied by mocked OCR tests: simply skip.
      if (recognized.price === null && focusedLineRetries < 3 && Array.isArray(read.lines)) {
        const px = attempt.targetWidth || (attempt.binary ? 1600 : 1200)
        const cropLeft = Math.floor(width * attempt.leftFraction)
        const cropTop = Math.floor(height * attempt.topFraction)
        const cropWidth = Math.min(width - cropLeft, Math.ceil(width * attempt.widthFraction))
        const cropHeight = Math.min(height - cropTop, Math.ceil(height * attempt.heightFraction))
        const ratio = cropWidth / px
        for (const line of read.lines) {
          if (focusedLineRetries >= 3) break
          if (!/(?:R\\s*[$S§]|BRL|PRE[CÇ]O|VALOR)/iu.test(line.text) || !/\\d/.test(line.text) ||
              !Array.isArray(line.box) || line.box.length !== 4) continue
          const [x1,y1,x2,y2] = line.box
          const lw = x2 - x1, lh = y2 - y1
          if (lw < 10 || lh < 5) continue
          const left = Math.max(0, cropLeft + Math.floor((x1 - lw * 0.11) * ratio))
          const top = Math.max(0, cropTop + Math.floor((y1 - lh * 0.40) * ratio))
          const right = Math.min(width, cropLeft + Math.ceil((x2 + lw * 0.08) * ratio))
          const bottom = Math.min(height, cropTop + Math.ceil((y2 + lh * 0.10) * ratio))
          if (right - left < 30 || bottom - top < 15) continue
          const key = [Math.round((left+right)/100),Math.round((top+bottom)/100)].join(':')
          if (focusedLineKeys.has(key)) continue
          focusedLineKeys.add(key)
          focusedLineRetries++
          try {
            const cropped = await sharp(imageBytes,{limitInputPixels:40_000_000})
              .extract({left,top,width:right-left,height:bottom-top})
              .resize({width:Math.min(2700,Math.max(900,Math.round((right-left)*3))),kernel:'lanczos3'})
              .grayscale().normalize().png().toBuffer()
            const focused = parsePhotoProductLabel((await ocr(cropped,7)).text)
            if (focused.price !== null) {
              recognized = {
                title:recognized.title || focused.title,
                price:focused.price,
                pack:recognized.pack || focused.pack,
                ...(recognized.sku || focused.sku ? {sku:recognized.sku || focused.sku}:{}),
              }
              break
            }
          } catch { /* Preserve earlier OCR results when a focused crop fails. */ }
        }
      }
      combined.title ||= recognized.title
      combined.price ??= recognized.price
      combined.pack ||= recognized.pack
      if (recognized.sku && !combined.sku) combined.sku = recognized.sku
      // When a complete sticker was read, don't run OCR against jewelry or
      // printed magazine text, which could produce a conflicting false price.
      if (combined.title && combined.price !== null && combined.pack) return combined
      } catch {
        // A single Tesseract timeout/failed crop must not discard a price
        // already extracted by another variant.
      }
    }
    if (combined.title && combined.price !== null) return combined

    // Fallback when the label is not in the corner. Do not derive prices
    // from standalone 3-4 digit numbers; require a marked decimal price.
    const image = await sharp(imageBytes, {limitInputPixels:40_000_000})
      .resize({width:1600,withoutEnlargement:true}).png().toBuffer()
    let last = {title:'',price:null,pack:''}
    try { last = parsePhotoProductLabel((await ocr(image,11)).text) } catch {
      // Return fields already read; do not hide the partial result.
    }
    const foundSku = combined.sku || last.sku
    return {
      title:combined.title || last.title,
      price:combined.price ?? last.price,
      pack:combined.pack || last.pack,
      ...(foundSku ? {sku:foundSku} : {}),
    }
  } catch {
    // No product may be blocked from review because OCR could not read it.
    return null
  }
}
