import crypto from 'node:crypto'
import sharp from 'sharp'
import { extractProductsFromHtml, safeRequest } from './scanner-collector.mjs'
import { extractFacilZapDetailProduct } from './scanner-platforms.mjs'

const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_LOCALIZED_ASSETS_PER_PRODUCT = 120
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

  if (!response?.ok) {
    const error = new Error(`Imagem respondeu HTTP ${Number(response?.status || 0)}.`)
    error.status = Number(response?.status || 0)
    throw error
  }
  const buffer = Buffer.isBuffer(response.buffer) ? response.buffer : Buffer.from(response.buffer || [])
  if (!buffer.length) throw new Error('A imagem retornou vazia.')
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem maior que o limite de importação.')

  const reportedType = mimeType(response.contentType)
  const detectedType = sniffImageMime(buffer)
  const type = ALLOWED_IMAGE_TYPES.has(reportedType) ? reportedType : detectedType
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new Error('O endereço não retornou uma imagem suportada.')

  return { buffer, mimeType: type }
}

export function isBraavoImageUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'thumb.braavo.me' &&
      /^\/slave\/(?:0|200|600|1000)\/.+/.test(url.pathname)
  } catch {
    return false
  }
}

function braavoImageUrl(value, width) {
  try {
    const url = new URL(String(value || ''))
    if (!isBraavoImageUrl(url.toString())) return ''
    url.pathname = url.pathname.replace(/^\/slave\/(?:0|200|600|1000)\//, `/slave/${width}/`)
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

async function imagePixels(buffer) {
  try {
    const metadata = await sharp(buffer, { failOn: 'none', limitInputPixels: 100_000_000 }).metadata()
    const width = Number(metadata.width || 0)
    const height = Number(metadata.height || 0)
    return { width, height, pixels: width * height }
  } catch {
    return { width: 0, height: 0, pixels: 0 }
  }
}

const FACILZAP_MEDIA_HOSTS = new Set([
  'arquivos.facilzap.app.br',
  'arquivos-cdn.facilzap.app.br',
  'arquivos.facilzap.com.br',
])

// Troca somente entre domínios de arquivos conhecidos da própria FácilZap,
// mantendo o caminho e a query idênticos. Nunca reutilizar foto de outro SKU.
function facilZapMediaFallbacks(source) {
  try {
    const url = new URL(source)
    if (url.protocol !== 'https:' || !FACILZAP_MEDIA_HOSTS.has(url.hostname.toLowerCase())) return []
    const hosts = url.hostname.toLowerCase() === 'arquivos.facilzap.app.br'
      ? ['arquivos-cdn.facilzap.app.br', 'arquivos.facilzap.com.br']
      : url.hostname.toLowerCase() === 'arquivos-cdn.facilzap.app.br'
        ? ['arquivos.facilzap.app.br', 'arquivos.facilzap.com.br']
        : ['arquivos-cdn.facilzap.app.br', 'arquivos.facilzap.app.br']
    return hosts.map((hostname) => {
      const alternative = new URL(url)
      alternative.hostname = hostname
      alternative.hash = ''
      return alternative.toString()
    })
  } catch {
    return []
  }
}

export async function fetchBestImportImage(url, { request = safeRequest, referer = '' } = {}) {
  const source = cleanUrl(url)
  if (!isBraavoImageUrl(source)) {
    try {
      const fetched = await fetchImportImage(source, { request, referer })
      return { ...fetched, resolvedUrl: source }
    } catch (firstError) {
      if (firstError?.status !== 404) throw firstError
      const fallbacks = facilZapMediaFallbacks(source)
      if (!fallbacks.length) throw firstError
      for (const alternate of fallbacks) {
        try {
          const fetched = await fetchImportImage(alternate, { request, referer })
          return { ...fetched, resolvedUrl: alternate }
        } catch {
          // Keep trying the other approved provider hostname.
        }
      }
      // Preserve the original 404 classification without leaking signed URLs.
      const failed = new Error('Imagem respondeu HTTP 404 em todos os domínios de arquivos conhecidos da FácilZap.')
      failed.status = 404
      throw failed
    }
  }

  const originalUrl = braavoImageUrl(source, 0) || source
  const original = await fetchImportImage(originalUrl, { request, referer })
  const originalSize = await imagePixels(original.buffer)

  // O CDN da Braavo pode entregar /slave/0 menor que a versão 1000 usada
  // pelo próprio srcset da loja. Só buscamos a alternativa maior quando
  // o arquivo original tem menos de 1000 px de largura.
  if (originalSize.width >= 1000) {
    return { ...original, resolvedUrl: originalUrl, width: originalSize.width, height: originalSize.height }
  }

  const candidates = [{ fetched: original, url: originalUrl, ...originalSize }]
  for (const width of [1000, 600]) {
    const candidateUrl = braavoImageUrl(source, width)
    if (!candidateUrl || candidateUrl === originalUrl) continue
    try {
      const fetched = await fetchImportImage(candidateUrl, { request, referer })
      const size = await imagePixels(fetched.buffer)
      candidates.push({ fetched, url: candidateUrl, ...size })
      if (size.width >= 1000) break
    } catch {
      // Mantém o melhor arquivo já disponível caso uma variante do CDN falhe.
    }
  }

  candidates.sort((a, b) => b.pixels - a.pixels || b.fetched.buffer.length - a.fetched.buffer.length)
  const best = candidates[0]
  return {
    ...best.fetched,
    resolvedUrl: best.url,
    width: best.width,
    height: best.height,
  }
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

  const fetched = await fetchBestImportImage(source, { request, referer })
  const assetId = crypto.randomUUID()
  const inserted = await query(
    `INSERT INTO media_assets (id,store_id,mime_type,original_name,byte_size,data,source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (store_id,source_url) WHERE source_url IS NOT NULL DO NOTHING
     RETURNING id`,
    [assetId, storeId, fetched.mimeType, originalName(source), fetched.buffer.length, fetched.buffer, source],
  )
  if (inserted.rows[0]?.id) return `/media/${inserted.rows[0].id}`
  // Reuse the asset stored by another concurrent job without an UPDATE lock.
  const existing = await query(
    'SELECT id FROM media_assets WHERE store_id=$1 AND source_url=$2 LIMIT 1',
    [storeId, source],
  )
  if (!existing.rows[0]?.id) throw new Error('Não foi possível confirmar a imagem armazenada.')
  return `/media/${existing.rows[0].id}`
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

  const generic = extractProductsFromHtml(response.body, response.url || source)
  // FácilZap embeds the authoritative product/gallery data in DadosProduto.
  // A generic HTML/JSON-LD parser can miss the gallery even when the photo is
  // still public. Only accept this fallback for the exact SKU or product name.
  const facilZapDetail = extractFacilZapDetailProduct(response.body, response.url || source)
  const sku = normalizeText(product?.sku)
  const name = normalizeText(product?.name)
  const matchingDetail = facilZapDetail && (
    (sku && normalizeText(facilZapDetail.sku) === sku) ||
    (name && normalizeText(facilZapDetail.title) === name)
  ) ? facilZapDetail : null
  const candidates = [
    ...(matchingDetail ? [matchingDetail] : []),
    ...(Array.isArray(generic) ? generic : []),
  ]
  if (!candidates.length) return []

  const match = (sku && candidates.find((candidate) => normalizeText(candidate?.sku) === sku)) ||
    (name && candidates.find((candidate) => normalizeText(candidate?.title) === name)) ||
    candidates.find(candidate => candidate?.source_url === source)
  // Do not borrow the only product on an unrelated page just because it is the
  // sole JSON-LD entry. Product images must match SKU, title or exact URL.
  return match ? candidateImages(match) : []
}

function mediaFailureReason(error) {
  const message = String(error?.message || '')
  const status = /Imagem respondeu HTTP (\d{3})\b/.exec(message)
  if (status) return 'HTTP ' + status[1] + ' ao baixar a foto'
  if (/maior que o limite|Resposta maior que o limite/i.test(message)) return 'foto acima do limite de 12 MB'
  if (/imagem suportada/i.test(message)) return 'servidor não entregou formato de imagem válido'
  if (/retornou vazia/i.test(message)) return 'resposta de imagem vazia'
  if (/tempo demais|ETIMEDOUT|timeout/i.test(message)) return 'tempo limite no download'
  if (/ENOTFOUND|EAI_AGAIN|domínio informado não aponta/i.test(message)) return 'falha de DNS ou domínio inacessível'
  if (/ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)) return 'conexão recusada ou interrompida'
  if (/imagem armazenada|media_assets|constraint|database|connection/i.test(message)) return 'falha ao gravar mídia no banco'
  return 'falha de rede ou armazenamento'
}
function mediaFailureSummary(url, error) {
  let host = 'servidor de imagens'
  try { host = new URL(url).hostname.slice(0, 100) } catch {}
  return host + ': ' + mediaFailureReason(error)
}

async function localizeUrlList(query, { storeId, urls, sourceUrl, request, maxAssets }) {
  const replacements = new Map()
  const failedUrls = new Set()
  const failures = []
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
    } catch (error) {
      failedUrls.add(candidate)
      failed += 1
      if (failures.length < 5) failures.push(mediaFailureSummary(candidate, error))
    }
  }

  return { replacements, failedUrls, failures, localized, failed }
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
  let recoveryFailure = ''
  const firstPassHasLocal = [...firstPass.replacements.values()].some(isLocalShopvaxMedia)
  if (mediaType === 'image' && !firstPassHasLocal && isRemoteHttp(sourceUrl)) {
    try {
      recoveredUrls = await recoverImportImagesFromSource(sourceUrl, product, { request })
    } catch (error) {
      recoveredUrls = []
      recoveryFailure = mediaFailureSummary(sourceUrl, error)
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
    : { replacements: new Map(), failedUrls: new Set(), failures: [], localized: 0, failed: 0 }

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
    // Expose only hostname and a classified failure, never signed URLs or tokens.
    failureReasons: [...new Set([...firstPass.failures, ...recoveryPass.failures, recoveryFailure].filter(Boolean))].slice(0, 5),
    changed: mediaUrl !== cleanUrl(product?.media_url) ||
      JSON.stringify(images) !== JSON.stringify(baseImages) ||
      JSON.stringify(variantImages) !== JSON.stringify(variantGroups),
  }
}
