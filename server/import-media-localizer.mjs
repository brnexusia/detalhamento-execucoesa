import crypto from 'node:crypto'
import { safeRequest } from './scanner-collector.mjs'

const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_LOCALIZED_ASSETS_PER_PRODUCT = 40
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

function cleanUrl(value) {
  return String(value || '').trim().slice(0, 2048)
}

export function isLocalShopvaxMedia(value) {
  return /^\/media\/[A-Za-z0-9_-]+(?:[?#].*)?$/.test(String(value || '').trim())
}

function isRemoteHttp(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function mimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase()
}

function originalName(value) {
  try {
    const url = new URL(value)
    const raw = url.pathname.split('/').filter(Boolean).at(-1) || 'imagem-importada'
    return decodeURIComponent(raw).slice(0, 255)
  } catch {
    return 'imagem-importada'
  }
}

export async function fetchImportImage(url, { request = safeRequest, referer = '' } = {}) {
  const source = cleanUrl(url)
  if (!isRemoteHttp(source)) throw new Error('URL de imagem inválida.')

  const headers = {}
  if (referer && isRemoteHttp(referer)) headers.referer = cleanUrl(referer)

  const response = await request(source, {
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
    headers,
    maxBytes: MAX_REMOTE_IMAGE_BYTES,
    maxOutputBytes: MAX_REMOTE_IMAGE_BYTES,
    responseType: 'buffer',
  })

  if (!response?.ok) throw new Error(`Imagem respondeu HTTP ${Number(response?.status || 0)}.`)
  const type = mimeType(response.contentType)
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new Error('O endereço não retornou uma imagem suportada.')
  const buffer = Buffer.isBuffer(response.buffer) ? response.buffer : Buffer.from(response.buffer || [])
  if (!buffer.length) throw new Error('A imagem retornou vazia.')
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem maior que o limite de importação.')

  return { buffer, mimeType: type }
}

async function persistRemoteImage(query, { storeId, url, referer, request }) {
  const source = cleanUrl(url)
  if (isLocalShopvaxMedia(source)) return source
  if (!isRemoteHttp(source)) return ''

  const cached = await query(
    'SELECT id FROM media_assets WHERE store_id=$1 AND source_url=$2 LIMIT 1',
    [storeId, source],
  )
  if (cached.rowCount) return `/media/${cached.rows[0].id}`

  const fetched = await fetchImportImage(source, { request, referer })
  const assetId = crypto.randomUUID()
  const inserted = await query(
    `INSERT INTO media_assets (id,store_id,mime_type,original_name,byte_size,data,source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (store_id,source_url) WHERE source_url IS NOT NULL
     DO UPDATE SET source_url=EXCLUDED.source_url
     RETURNING id`,
    [assetId, storeId, fetched.mimeType, originalName(source), fetched.buffer.length, fetched.buffer, source],
  )
  return `/media/${inserted.rows[0]?.id || assetId}`
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanUrl).filter(Boolean))]
}

export async function localizeImportedProductMedia({
  query,
  storeId,
  product,
  sourceUrl = '',
  request = safeRequest,
  maxAssets = MAX_LOCALIZED_ASSETS_PER_PRODUCT,
}) {
  if (typeof query !== 'function') throw new Error('Consulta ao banco não configurada.')
  const mediaType = product?.media_type === 'video' ? 'video' : 'image'
  const baseImages = unique(product?.images)
  const variantGroups = Array.isArray(product?.variant_images) ? product.variant_images : []
  const candidateUrls = unique([
    ...(mediaType === 'image' ? [product?.media_url] : []),
    ...baseImages,
    ...variantGroups.flatMap((group) => Array.isArray(group?.images) ? group.images : []),
  ])

  const replacements = new Map()
  let localized = 0
  let failed = 0

  for (const candidate of candidateUrls.slice(0, Math.max(1, Number(maxAssets) || MAX_LOCALIZED_ASSETS_PER_PRODUCT))) {
    if (isLocalShopvaxMedia(candidate)) {
      replacements.set(candidate, candidate)
      continue
    }
    if (!isRemoteHttp(candidate)) continue
    try {
      const local = await persistRemoteImage(query, { storeId, url: candidate, referer: sourceUrl, request })
      if (local) {
        replacements.set(candidate, local)
        localized += 1
      }
    } catch {
      failed += 1
    }
  }

  const replace = (value) => replacements.get(cleanUrl(value)) || cleanUrl(value)
  const images = unique(baseImages.map(replace))
  const variantImages = variantGroups.map((group) => ({
    ...group,
    images: unique((Array.isArray(group?.images) ? group.images : []).map(replace)),
  }))

  let mediaUrl = replace(product?.media_url)
  if (mediaType === 'image') {
    const firstLocal = images.find(isLocalShopvaxMedia)
    if (!isLocalShopvaxMedia(mediaUrl) && firstLocal) mediaUrl = firstLocal
    if (!mediaUrl) mediaUrl = images[0] || ''
  }

  return {
    mediaUrl,
    images,
    variantImages,
    localized,
    failed,
    changed: mediaUrl !== cleanUrl(product?.media_url) ||
      JSON.stringify(images) !== JSON.stringify(baseImages) ||
      JSON.stringify(variantImages) !== JSON.stringify(variantGroups),
  }
}
