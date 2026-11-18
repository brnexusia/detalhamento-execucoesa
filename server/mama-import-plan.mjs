import crypto from 'node:crypto'

// Migration-specific identities. No changes to the normal user-facing importer.
export const MAMA_IMPORT_MARKER = 'mama-fotos-oneoff-20261118'

export function canonicalMamaName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}

export function mamaPhotoSku(albumUrl, externalId) {
  const source = new URL(String(albumUrl || ''))
  if (!['photos.app.goo.gl', 'photos.google.com'].includes(source.hostname) ||
      !/^foto-\d{1,6}$/i.test(String(externalId || ''))) {
    throw new Error('Identidade da foto da MAMA inválida.')
  }
  // Fixed identity across runs; the original sticker reference remains in the description.
  const key = source.origin + source.pathname + ':' + String(externalId).toLowerCase()
  return 'MAMA-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 22).toUpperCase()
}

export function mamaStablePhotoSku(albumUrl, sourceImageKey) {
  const source = new URL(String(albumUrl || ''))
  const key = String(sourceImageKey || '')
  if (!['photos.app.goo.gl','photos.google.com'].includes(source.hostname) ||
      !/^[A-Za-z0-9_-]{22}$/.test(key)) throw new Error('Imagem original da MAMA sem identidade confiável.')
  return 'MAMA-' + crypto.createHash('sha256')
    .update(source.origin + source.pathname + ':google-photo:' + key)
    .digest('hex').slice(0,22).toUpperCase()
}

export function prepareMamaPhoto({ album, albumUrl, candidate, normalized, requireStableIdentity = false }) {
  const input = normalized && typeof normalized === 'object' ? normalized : {}
  const raw = candidate && typeof candidate === 'object' ? candidate : {}
  const price = input.price == null || input.price === '' ? NaN : Number(input.price)
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
    return { eligible: false, reason: 'missing_or_unverified_price' }
  }
  const image = String(input.media_url || input.images?.[0] || '')
  if (!/^\/media\/[0-9a-f-]{36}$/i.test(image)) {
    return { eligible: false, reason: 'missing_local_image' }
  }
  const externalId = String(raw.external_id || '')
  const sourceImageKey = String(raw.source_image_key || '')
  if (requireStableIdentity && !sourceImageKey) {
    throw new Error('Identidade de foto ausente; recapture o álbum para evitar preço associado à foto errada.')
  }
  const sku = sourceImageKey
    ? mamaStablePhotoSku(albumUrl, sourceImageKey)
    : mamaPhotoSku(albumUrl, externalId)
  const labelName = String(input.name || '').trim()
  const placeholder = !labelName || /^Foto importada \d+$/i.test(labelName)
  const index = externalId.match(/\d+/)?.[0] || ''
  const name = placeholder ? album + ' · Foto ' + index.padStart(4, '0') : labelName
  const originalSku = String(input.sku || '').trim()
  const description = [
    String(input.description || '').trim(),
    originalSku && originalSku.toUpperCase() !== sku ? 'Referência da etiqueta: ' + originalSku : '',
  ].filter(Boolean).join('\n').slice(0, 2000)
  return {
    eligible: true,
    data: {
      ...input,
      name: name.slice(0, 180),
      price: Math.round(price * 100) / 100,
      sku,
      category: album.slice(0, 80),
      description,
      media_url: image,
      images: [image],
      media_type: 'image',
    },
  }
}
