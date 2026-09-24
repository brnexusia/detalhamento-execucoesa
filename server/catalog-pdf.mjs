import PDFDocument from 'pdfkit'

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
    `SELECT COALESCE(v.data,a.data) AS data,COALESCE(v.mime_type,a.mime_type) AS mime_type
     FROM media_assets a
     LEFT JOIN media_asset_variants v ON v.asset_id=a.id AND v.variant=$2
     WHERE a.id=$1
     LIMIT 1`,
    [assetId, variant],
  )
  if (!result.rowCount) return null
  const row = result.rows[0]
  return {
    data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || []),
    mimeType: String(row.mime_type || ''),
  }
}

function drawFooter(doc) {
  const y = doc.page.height - 20
  doc.save()
  doc.font('Helvetica').fontSize(5.5).fillColor('#8b8b86')
  doc.text('gerado via shopvax', 32, y, { width: doc.page.width - 64, align: 'center', lineBreak: false })
  doc.restore()
}

function drawHeader(doc, store, catalog, logo) {
  const left = 32
  const top = 28
  if (logo?.data?.length) {
    try { doc.image(logo.data, left, top, { fit: [42, 42], align: 'center', valign: 'center' }) } catch {}
  }
  const textLeft = logo?.data?.length ? left + 54 : left
  doc.fillColor('#151515').font('Helvetica-Bold').fontSize(18).text(cleanText(store.name, 100), textLeft, top, { width: 330, lineBreak: false })
  doc.fillColor('#696963').font('Helvetica').fontSize(9).text(cleanText(catalog.name, 100), textLeft, top + 24, { width: 330, lineBreak: false })
  doc.fillColor('#696963').fontSize(8).text(
    [kindLabel(catalog.kind), catalog.minimum_order == null ? '' : `Pedido mínimo: ${money.format(Number(catalog.minimum_order))}`].filter(Boolean).join(' · '),
    textLeft,
    top + 38,
    { width: 400, lineBreak: false },
  )
  doc.moveTo(32, 78).lineTo(doc.page.width - 32, 78).lineWidth(0.6).strokeColor('#d4d1c9').stroke()
}

function drawEmptyImage(doc, x, y, w, h) {
  doc.save()
  doc.rect(x, y, w, h).fill('#eeeae2')
  doc.fillColor('#8c887f').font('Helvetica').fontSize(7).text('SEM IMAGEM', x, y + h / 2 - 4, { width: w, align: 'center' })
  doc.restore()
}

async function drawProductCard(doc, product, x, y, w, h, imageLoader) {
  const padding = 9
  doc.save()
  doc.roundedRect(x, y, w, h, 4).lineWidth(0.6).strokeColor('#d6d1c7').stroke()

  const imageW = w - padding * 2
  const imageH = 115
  doc.rect(x + padding, y + padding, imageW, imageH).fill('#f0ece4')
  let image = null
  try { image = await imageLoader(product.media_url || product.images?.[0] || '') } catch {}
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
  doc.fillColor('#777269').font('Helvetica').fontSize(6.8)
    .text([cleanText(product.category, 50), cleanText(product.sku, 50)].filter(Boolean).join(' · ') || 'Produto', x + padding, textY, { width: imageW, lineBreak: false })
  doc.fillColor('#171714').font('Helvetica-Bold').fontSize(10)
    .text(cleanText(product.name, 100), x + padding, textY + 12, { width: imageW, height: 26, ellipsis: true })
  doc.fillColor('#171714').font('Helvetica-Bold').fontSize(11)
    .text(money.format(Number(product.public_price || product.price || 0)), x + padding, textY + 41, { width: imageW, lineBreak: false })

  const variations = Array.isArray(product.variations)
    ? product.variations.map((group) => `${cleanText(group?.name, 30)}: ${(Array.isArray(group?.options) ? group.options : []).map((item) => cleanText(item, 20)).join(' / ')}`).filter(Boolean).join(' · ')
    : ''
  if (variations) {
    doc.fillColor('#777269').font('Helvetica').fontSize(6.6)
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

  const drawChrome = () => {
    drawHeader(doc, store, catalog, logo)
    drawFooter(doc)
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
      drawChrome()
    }
    const slot = index % 6
    const col = slot % 2
    const row = Math.floor(slot / 2)
    const x = left + col * (cardW + gap)
    const y = top + row * (cardH + rowGap)
    await drawProductCard(doc, products[index], x, y, cardW, cardH, (url) => imageLoader(url, 'medium'))
  }

  doc.end()
}
