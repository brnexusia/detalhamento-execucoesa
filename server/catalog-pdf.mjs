import PDFDocument from 'pdfkit'
import { resolveShopvaxTheme } from './shopvax-theme-presets.mjs'
import sharp from 'sharp'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function kindLabel(kind) {
  return kind === 'atacado' ? 'Atacado' : kind === 'varejo' ? 'Varejo' : 'Catálogo'
}

function mediaAssetId(url) {
  const match = /^\/media\/([A-Za-z0-9_-]+)/.exec(String(url || '').trim())
  return match?.[1] || ''
}

export async function loadCatalogMedia(query, url, variant = 'medium') {
  const assetId = mediaAssetId(url)
  if (!assetId) return null
  const result = await query(
    'SELECT data,mime_type FROM media_assets WHERE id=$1 LIMIT 1',
    [assetId],
  )
  if (!result.rowCount) return null
  const row = result.rows[0]
  const source = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || [])
  if (!source.length) return null
  try {
    const data = await sharp(source, { failOn: 'none', limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: variant === 'thumb' ? 400 : 900, height: variant === 'thumb' ? 400 : 900, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#f0ece4' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    return { data, mimeType: 'image/jpeg' }
  } catch {
    return null
  }
}

// A decoração sazonal é vetorial e não altera produtos, valores ou mídia.
// Mantém a área impressa do catálogo dentro das margens de A4.
function drawSeasonalPrintMotif(doc, theme) {
  if (theme.id === 'padrao') return
  const right = doc.page.width - 30
  doc.save()
  if (theme.id === 'black-friday') {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        doc.rect(right - col * 11, 20 + row * 11, 6, 6).fill(row === 1 ? theme.surface : theme.accent)
      }
    }
  } else if (theme.id === 'natal') {
    doc.lineWidth(2).strokeColor(theme.accent)
    for (let step = -2; step <= 2; step += 1) {
      const cx = right - 35 + step * 15
      doc.moveTo(cx, 23).lineTo(cx, 52).stroke()
      doc.circle(cx, 22, 3).fill(theme.accent)
      doc.circle(cx, 52, 3).fill(theme.accent)
    }
  } else if (theme.id === 'sao-joao') {
    doc.lineWidth(1).strokeColor(theme.surface).moveTo(right - 98, 20).lineTo(right, 20).stroke()
    for (let i = 0; i < 6; i += 1) {
      const x = right - 98 + i * 16
      doc.moveTo(x, 21).lineTo(x + 7, 40).lineTo(x + 14, 21).closePath()
        .fill(i % 2 ? theme.surface : theme.accent)
    }
  }
  doc.restore()
}

function drawFooter(doc, theme, pageNumber) {
  const y = doc.page.height - 29
  doc.save()
  doc.rect(0, y - 3, doc.page.width, 33).fill(theme.background)
  doc.rect(0, y - 3, doc.page.width, 2).fill(theme.accent)
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(theme.id === 'padrao' ? theme.ink : '#FFFFFF')
  doc.text('CATÁLOGO · GRADE · TALÃO', 32, y + 8, { width: 240, lineBreak: false })
  doc.text(`SHOPVAX  /  ${String(pageNumber).padStart(2, '0')}`, doc.page.width - 150, y + 8,
    { width: 118, align: 'right', lineBreak: false })
  doc.font('Helvetica').fontSize(5.5).fillColor(theme.id === 'padrao' ? theme.ink : '#FFFFFF')
  doc.text('gerado via shopvax', doc.page.width / 2 - 55, y + 8,
    { width: 110, align: 'center', lineBreak: false })
  doc.restore()
}

function drawHeader(doc, store, catalog, logo, theme) {
  const left = 32
  const top = 26
  const darkTheme = theme.id !== 'padrao'
  const foreground = darkTheme ? '#FFFFFF' : theme.ink
  doc.save()
  doc.rect(0, 0, doc.page.width, 87).fill(theme.background)
  doc.rect(0, 84, doc.page.width, 3).fill(theme.accent)
  doc.rect(0, 0, 7, 87).fill(theme.accent)
  drawSeasonalPrintMotif(doc, theme)
  doc.font('Helvetica-Bold').fontSize(7).fillColor(darkTheme ? theme.accent : theme.ink)
    .text(theme.label, left, 11, { width: doc.page.width - 64, lineBreak: false })
  if (logo?.data?.length) {
    try { doc.image(logo.data, left, top, { fit: [42, 42], align: 'center', valign: 'center' }) } catch {}
  }
  const textLeft = logo?.data?.length ? left + 54 : left
  doc.fillColor(foreground).font('Helvetica-Bold').fontSize(18)
    .text(cleanText(store.name, 100), textLeft, top, { width: 330, lineBreak: false })
  doc.fillColor(foreground).font('Helvetica').fontSize(9)
    .text(cleanText(catalog.name, 100), textLeft, top + 23, { width: 330, lineBreak: false })
  const kind = [kindLabel(catalog.kind), catalog.minimum_order == null ? '' :
    `Pedido mínimo: ${money.format(Number(catalog.minimum_order))}`].filter(Boolean).join(' · ')
  doc.fontSize(7.5).text(kind, textLeft, top + 36, { width: 420, lineBreak: false })
  // Texto sazonal aparece no PDF, mas nunca anuncia desconto, preço ou prazo inventado.
  if (darkTheme) doc.fontSize(8).text(theme.message, left, 70, { width: doc.page.width - 64, align: 'right', lineBreak: false })
  doc.restore()
}

function drawEmptyImage(doc, x, y, w, h) {
  doc.save()
  doc.rect(x, y, w, h).fill('#eeeae2')
  doc.fillColor('#8c887f').font('Helvetica').fontSize(7).text('SEM IMAGEM', x, y + h / 2 - 4, { width: w, align: 'center' })
  doc.restore()
}

async function drawProductCard(doc, product, x, y, w, h, imageLoader, theme) {
  const padding = 9
  doc.save()
  doc.roundedRect(x, y, w, h, 4).fillAndStroke(theme.surface, theme.line)
  // Fita editorial discreta: preserva a foto e a identidade própria da loja.
  doc.rect(x + 1, y + 1, w - 2, 3).fill(theme.accent)

  const imageW = w - padding * 2
  const imageH = 115
  doc.rect(x + padding, y + padding, imageW, imageH).fill(theme.soft)
  let image = null
  const imageSource = product.media_type === 'image'
    ? (product.media_url || product.images?.[0] || '')
    : (product.images?.[0] || '')
  try { image = await imageLoader(imageSource) } catch {}
  if (image?.data?.length) {
    try {
      doc.image(image.data, x + padding, y + padding, {
        fit: [imageW, imageH],
        align: 'center',
        valign: 'center',
      })
    } catch {
      drawEmptyImage(doc, x + padding, y + padding, imageW, imageH)
    }
  } else {
    drawEmptyImage(doc, x + padding, y + padding, imageW, imageH)
  }

  const textY = y + padding + imageH + 9
  doc.fillColor(theme.ink).font('Helvetica').fontSize(6.8)
    .text([cleanText(product.category, 50), cleanText(product.sku, 50)].filter(Boolean).join(' · ') || 'Produto', x + padding, textY, { width: imageW, lineBreak: false })
  doc.fillColor(theme.ink).font('Helvetica-Bold').fontSize(10)
    .text(cleanText(product.name, 100), x + padding, textY + 12, { width: imageW, height: 26, ellipsis: true })
  doc.fillColor(theme.ink).font('Helvetica-Bold').fontSize(11)
    .text(money.format(Number(product.public_price || product.price || 0)), x + padding, textY + 41, { width: imageW, lineBreak: false })

  const variations = Array.isArray(product.variations)
    ? product.variations.map((group) => `${cleanText(group?.name, 30)}: ${(Array.isArray(group?.options) ? group.options : []).map((item) => cleanText(item, 20)).join(' / ')}`).filter(Boolean).join(' · ')
    : ''
  if (variations) {
    doc.fillColor(theme.ink).font('Helvetica').fontSize(6.6)
      .text(variations, x + padding, textY + 58, { width: imageW, height: 24, ellipsis: true })
  }
  doc.restore()
}

export async function streamCatalogPdf({ res, store, catalog, products, imageLoader }) {
  const safeName = cleanText(catalog.name || 'catalogo', 80).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'catalogo'
  res.status(200)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-shopvax.pdf"`)
  res.setHeader('Cache-Control', 'private, no-store')
  const theme = resolveShopvaxTheme(store)
  res.setHeader('X-Shopvax-Theme', theme.id)

  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: { Title: `${catalog.name} - ${store.name}`, Author: 'Shopvax' } })
  doc.pipe(res)

  let logo = null
  try { logo = await imageLoader(store.logo_url || '', 'thumb') } catch {}

  const pageWidth = 595.28
  const left = 32
  const gap = 12
  const cardW = (pageWidth - left * 2 - gap) / 2
  const cardH = 226
  const top = 92
  const rowGap = 10

  let pageNumber = 1
  const drawChrome = () => {
    doc.save()
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(theme.surface)
    doc.restore()
    drawHeader(doc, store, catalog, logo, theme)
    drawFooter(doc, theme, pageNumber)
  }
  drawChrome()

  if (!products.length) {
    doc.fillColor('#777269').font('Helvetica').fontSize(11).text('Nenhum produto visível neste catálogo.', 32, 120, { width: pageWidth - 64, align: 'center' })
    doc.end()
    return
  }

  for (let index = 0; index < products.length; index += 1) {
    if (index > 0 && index % 6 === 0) {
      doc.addPage()
      pageNumber += 1
      drawChrome()
    }
    const slot = index % 6
    const col = slot % 2
    const row = Math.floor(slot / 2)
    const x = left + col * (cardW + gap)
    const y = top + row * (cardH + rowGap)
    await drawProductCard(doc, products[index], x, y, cardW, cardH, (url) => imageLoader(url, 'medium'), theme)
  }

  doc.end()
}
