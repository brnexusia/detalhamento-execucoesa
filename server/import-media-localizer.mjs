import crypto from 'node:crypto'
import { extractProductsFromHtml, safeRequest } from './scanner-collector.mjs'
import { optimizeImageBuffer, saveImageVariants } from './media-optimizer.mjs'

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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
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

function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ''
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png'
  const head6 = buffer.subarray(0, 6).toString('ascii')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii').startsWith('ftypavi')) return 'image/avif'
  return ''
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

function browserHeaders(referer = '') {
  const headers = {
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
    'cache-control': 'no-cache',
  }
  if (referer && isRemoteHttp(referer)) {
    const clean = cleanUrl(referer)
    headers.referer = clean
    try { headers.origin = new URL(clean).origin } catch {}
  }
  return headers
}

export async function fetchImportImage(url, { request = safeRequest, referer = '' } = {}) {
  const source = cleanUrl(url)
  if (!isRemoteHttp(source)) throw new Error('URL de imagem inválida.')

  const response = await request(source, {
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
    headers: browserHeaders(referer),
    maxBytes: MAX_REMOTE_IMAGE_BYTES,
    maxOutputBytes: MAX_REMOTE_IMAGE_BYTES,
    responseType: 'buffer',
  })

  if (!response?.ok) throw new Error(`Imagem respondeu HTTP ${Number(response?.status || 0)}.`)
  const buffer = Buffer.isBuffer(response.buffer) ? response.buffer : Buffer.from(response.buffer || [])
  if (!buffer.length) throw new Error('A imagem retornou vazia.')
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem maior que o limite de importação.')

  const reportedType = mimeType(response.contentType)
  const detectedType = sniffImageMime(buffer)
  const type = ALLOWED_IMAGE_TYPES.has(reportedType) ? reportedType : detectedType
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new Error('O endereço não retornou uma imagem suportada.')

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
  const storedId = inserted.rows[0]?.id || assetId
  try {
    const optimized = await optimizeImageBuffer(fetched.buffer)
    await saveImageVariants(query, storedId, optimized.variants)
  } catch {
    // A imagem original continua válida mesmo se a otimização não for possível.
  }
  return `/media/${storedId}`
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanUrl).filter(Boolean))]
}

function candidateImages(candidate) {
  return unique([
    ...(Array.isArray(candidate?.images) ? candidate.images : []),
    ...(Array.isArray(candidate?.variants)
      ? candidate.variants.flatMap((variant) => Array.isArray(variant?.images) ? variant.images : [])
      : []),
  ])
}

export async function recoverImportImagesFromSource(sourceUrl, product, { request = safeRequest } = {}) {
  const source = cleanUrl(sourceUrl)
  if (!isRemoteHttp(source)) return []

  const response = await request(source, {
    accept: 'text/html,application/xhtml+xml',
    headers: browserHeaders(source),
    maxBytes: 6 * 1024 * 1024,
  })
  if (!response?.ok || !String(response.contentType || '').includes('html')) return []

  const candidates = extractProductsFromHtml(response.body, response.url || source)
  if (!Array.isArray(candidates) || !candidates.length) return []

  const sku = normalizeText(product?.sku)
  const name = normalizeText(product?.name)
  const match = (sku && candidates.find((candidate) => normalizeText(candidate?.sku) === sku)) ||
    (name && candidates.find((candidate) => normalizeText(candidate?.title) === name)) ||
    (candidates.length === 1 ? candidates[0] : null)
  return match ? candidateImages(match) : []
}

async function localizeUrlList(query, { storeId, urls, sourceUrl, request, maxAssets }) {
  const replacements = new Map()
  const failedUrls = new Set()
  let localized = 0
  let failed = 0

  for (const candidate of unique(urls).slice(0, Math.max(1, Number(maxAssets) || MAX_LOCALIZED_ASSETS_PER_PRODUCT))) {
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
      failedUrls.add(candidate)
      failed += 1
    }
  }

  return { replacements, failedUrls, localized, failed }
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
  const originalUrls = unique([
    ...(mediaType === 'image' ? [product?.media_url] : []),
    ...baseImages,
    ...variantGroups.flatMap((group) => Array.isArray(group?.images) ? group.images : []),
  ])

  const firstPass = await localizeUrlList(query, {
    storeId,
    urls: originalUrls,
    sourceUrl,
    request,
    maxAssets,
  })

  let recoveredUrls = []
  const firstPassHasLocal = [...firstPass.replacements.values()].some(isLocalShopvaxMedia)
  if (mediaType === 'image' && !firstPassHasLocal && isRemoteHttp(sourceUrl)) {
    try {
      recoveredUrls = await recoverImportImagesFromSource(sourceUrl, product, { request })
    } catch {
      recoveredUrls = []
    }
  }

  const recoveryPass = recoveredUrls.length
    ? await localizeUrlList(query, {
        storeId,
        urls: recoveredUrls,
        sourceUrl,
        request,
        maxAssets: Math.max(1, Number(maxAssets) || MAX_LOCALIZED_ASSETS_PER_PRODUCT),
      })
    : { replacements: new Map(), failedUrls: new Set(), localized: 0, failed: 0 }

  const replacements = new Map([...firstPass.replacements, ...recoveryPass.replacements])
  const failedUrls = new Set([...firstPass.failedUrls, ...recoveryPass.failedUrls])
  const replace = (value) => replacements.get(cleanUrl(value)) || cleanUrl(value)

  const mappedBase = unique(baseImages.map(replace))
  const recoveredMapped = unique(recoveredUrls.map(replace))
  const localBase = unique([...mappedBase, ...recoveredMapped].filter(isLocalShopvaxMedia))
  const images = localBase.length
    ? localBase
    : unique([...mappedBase, ...recoveredMapped]).filter((value) => !failedUrls.has(value))

  const variantImages = variantGroups.map((group) => {
    const mapped = unique((Array.isArray(group?.images) ? group.images : []).map(replace))
    const local = mapped.filter(isLocalShopvaxMedia)
    return {
      ...group,
      images: local.length ? local : mapped.filter((value) => !failedUrls.has(value)),
    }
  })

  let mediaUrl = replace(product?.media_url)
  if (mediaType === 'image') {
    const firstLocal = images.find(isLocalShopvaxMedia)
    if (!isLocalShopvaxMedia(mediaUrl) && firstLocal) mediaUrl = firstLocal
    if (failedUrls.has(mediaUrl) && firstLocal) mediaUrl = firstLocal
    if (!mediaUrl) mediaUrl = images[0] || ''
  }

  return {
    mediaUrl,
    images,
    variantImages,
    localized: firstPass.localized + recoveryPass.localized,
    failed: firstPass.failed + recoveryPass.failed,
    recovered: recoveredUrls.length,
    changed: mediaUrl !== cleanUrl(product?.media_url) ||
      JSON.stringify(images) !== JSON.stringify(baseImages) ||
      JSON.stringify(variantImages) !== JSON.stringify(variantGroups),
  }
}
