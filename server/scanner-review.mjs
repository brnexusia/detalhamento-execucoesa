import { canonicalVariationName } from './scanner-normalizer.mjs'

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function multiline(value, max) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)
}

function money(value) {
  if (value === '' || value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number * 100) / 100
}

function safeMediaUrl(value) {
  const raw = String(value ?? '').trim().slice(0, 1000)
  if (!raw) return ''
  if (/^\/media\/[a-zA-Z0-9-]+$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function unique(values, maxItems, maxLength) {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const item = text(value, maxLength)
    if (!item) continue
    const key = item.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= maxItems) break
  }
  return result
}

export function sanitizeReviewVariations(value) {
  const groups = []
  const seen = new Set()
  for (const raw of Array.isArray(value) ? value : []) {
    const name = canonicalVariationName(raw?.name)
    const options = unique(raw?.options, 30, 60)
    if (!name || !options.length) continue
    const key = name.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) {
      const existing = groups.find((group) => group.name.toLocaleLowerCase('pt-BR') === key)
      if (existing) existing.options = unique([...existing.options, ...options], 30, 60)
      continue
    }
    seen.add(key)
    groups.push({ name: text(name, 40), options })
    if (groups.length >= 5) break
  }
  return groups
}

export function sanitizeReviewData(value) {
  const input = value && typeof value === 'object' ? value : {}
  const images = []
  const seenImages = new Set()
  for (const raw of Array.isArray(input.images) ? input.images : []) {
    const url = safeMediaUrl(raw)
    if (!url || seenImages.has(url)) continue
    seenImages.add(url)
    images.push(url)
    if (images.length >= 12) break
  }

  let mediaUrl = safeMediaUrl(input.media_url)
  if (!mediaUrl && images.length) mediaUrl = images[0]
  if (mediaUrl && !images.includes(mediaUrl) && input.media_type !== 'video') images.unshift(mediaUrl)

  return {
    name: text(input.name, 180),
    description: multiline(input.description, 2000),
    sku: text(input.sku, 80),
    category: text(input.category, 80),
    brand: text(input.brand, 100),
    price: money(input.price),
    currency: text(input.currency, 10).toUpperCase(),
    images,
    media_url: mediaUrl,
    media_type: input.media_type === 'video' ? 'video' : 'image',
    pack: text(input.pack, 160),
    variations: sanitizeReviewVariations(input.variations),
    availability: text(input.availability, 100),
    source_url: safeMediaUrl(input.source_url),
    source: text(input.source, 80),
  }
}

export function reviewWarnings(data) {
  const warnings = []
  if (!data.name) warnings.push('missing_name')
  if (data.price == null) warnings.push('missing_price')
  if (!data.images.length && !data.media_url) warnings.push('missing_image')
  if (!data.sku) warnings.push('missing_sku')
  if (!data.category) warnings.push('missing_category')
  if (!data.description) warnings.push('missing_description')
  return warnings
}

export function reviewConfidence(warnings) {
  const weights = {
    missing_name: 0.45,
    missing_price: 0.25,
    missing_image: 0.12,
    missing_description: 0.07,
    missing_category: 0.06,
    missing_sku: 0.05,
  }
  const penalty = (Array.isArray(warnings) ? warnings : []).reduce((sum, warning) => sum + (weights[warning] || 0.03), 0)
  return Math.max(0, Math.min(1, Math.round((1 - penalty) * 100) / 100))
}

export function reviewIsPublishable(data) {
  return Boolean(data?.name && Number(data?.price) > 0)
}

export function prepareReview(value) {
  const data = sanitizeReviewData(value)
  const warnings = reviewWarnings(data)
  return { data, warnings, confidence: reviewConfidence(warnings), publishable: reviewIsPublishable(data) }
}
