import { load } from 'cheerio'

const COLOR_NAMES = new Set(['cor', 'cores', 'color', 'colors', 'colour', 'colours'])
const SIZE_NAMES = new Set(['tamanho', 'tamanhos', 'tam', 'size', 'sizes', 'numero', 'número', 'numeracao', 'numeração'])
const IGNORED_OPTIONS = new Set(['default title', 'padrão', 'padrao', 'default', 'único', 'unico', 'one size'])
const MAX_PRODUCT_IMAGES = 40
const MAX_VARIANT_IMAGES = 8
const MAX_VARIANT_IMAGE_GROUPS = 80

function text(value, max = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function cleanDescription(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (!/[<>]/.test(raw)) return text(raw, 6000)
  try {
    const $ = load(`<body>${raw}</body>`)
    return text($('body').text(), 6000)
  } catch {
    return text(raw.replace(/<[^>]*>/g, ' '), 6000)
  }
}

function canonicalKey(value) {
  return text(value, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function canonicalVariationName(value) {
  const key = canonicalKey(value)
  const tokens = key.split(' ').filter(Boolean)
  if (COLOR_NAMES.has(key) || tokens.some((token) => COLOR_NAMES.has(token))) return 'Cor'
  if (SIZE_NAMES.has(key) || tokens.some((token) => SIZE_NAMES.has(token))) return 'Tamanho'
  if (!key) return ''
  const original = text(value, 40).replace(/[-_]+/g, ' ')
  return original.charAt(0).toUpperCase() + original.slice(1)
}

function validOption(value) {
  const result = text(value, 80)
  if (!result) return ''
  if (IGNORED_OPTIONS.has(canonicalKey(result))) return ''
  return result
}

function addGroup(map, name, values) {
  const canonical = canonicalVariationName(name)
  if (!canonical) return
  const key = canonicalKey(canonical)
  if (!map.has(key)) map.set(key, { name: canonical, values: new Map() })
  const group = map.get(key)
  for (const raw of Array.isArray(values) ? values : [values]) {
    const option = validOption(raw)
    if (!option) continue
    const optionKey = canonicalKey(option)
    if (optionKey && !group.values.has(optionKey)) group.values.set(optionKey, option)
  }
}

function propertyValues(property) {
  if (!property || typeof property !== 'object') return []
  if (Array.isArray(property.values)) return property.values
  if (property.value != null) return [property.value]
  return []
}

export function normalizeVariations(candidate) {
  const groups = new Map()
  const properties = Array.isArray(candidate?.properties) ? candidate.properties : []
  for (const property of properties) addGroup(groups, property?.name, propertyValues(property))

  const propertyOrder = properties.map((property) => canonicalVariationName(property?.name)).filter(Boolean).slice(0, 3)
  const variants = Array.isArray(candidate?.variants) ? candidate.variants : []
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object') continue
    addGroup(groups, 'Cor', variant.color)
    addGroup(groups, 'Tamanho', variant.size)
    if (Array.isArray(variant.properties)) {
      for (const property of variant.properties) addGroup(groups, property?.name, propertyValues(property))
    }
    for (let index = 1; index <= 3; index += 1) {
      const value = variant[`option${index}`]
      const name = propertyOrder[index - 1]
      if (name && value) addGroup(groups, name, value)
    }
  }

  const priority = { Cor: 0, Tamanho: 1 }
  return [...groups.values()]
    .map((group) => ({ name: group.name, options: [...group.values.values()].slice(0, 30) }))
    .filter((group) => group.options.length)
    .sort((a, b) => (priority[a.name] ?? 10) - (priority[b.name] ?? 10) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 5)
}

function candidatePrice(candidate) {
  const direct = Number(candidate?.price)
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 100) / 100
  const prices = (Array.isArray(candidate?.variants) ? candidate.variants : [])
    .map((variant) => Number(variant?.price))
    .filter((price) => Number.isFinite(price) && price > 0)
  if (!prices.length) return null
  return Math.round(Math.min(...prices) * 100) / 100
}

function safeImageUrl(raw) {
  try {
    const url = new URL(String(raw || ''))
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch { return '' }
}

function imageValues(value) {
  const items = value == null ? [] : Array.isArray(value) ? value : [value]
  return items.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    return [item.src, item.url, item.contentUrl, item.thumbnailUrl].filter(Boolean)
  })
}

function variantImages(variant) {
  return [
    ...imageValues(variant?.images),
    ...imageValues(variant?.image),
    ...imageValues(variant?.featured_image),
    ...imageValues(variant?.featuredImage),
  ]
}

function mergeImageUrls(values, max = MAX_PRODUCT_IMAGES) {
  const result = []
  const seen = new Set()
  for (const raw of Array.isArray(values) ? values : []) {
    const value = safeImageUrl(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (result.length >= max) break
  }
  return result
}

function normalizeImages(candidate) {
  return mergeImageUrls([
    ...(Array.isArray(candidate?.images) ? candidate.images : []),
    ...(Array.isArray(candidate?.variants) ? candidate.variants.flatMap(variantImages) : []),
  ])
}

function variantSelections(variant, propertyOrder) {
  const selections = {}
  const add = (name, value) => {
    const canonical = canonicalVariationName(name)
    const option = validOption(value)
    if (canonical && option && !selections[canonical]) selections[canonical] = option
  }
  add('Cor', variant?.color)
  add('Tamanho', variant?.size)
  if (Array.isArray(variant?.properties)) {
    for (const property of variant.properties) {
      const values = propertyValues(property)
      if (values.length) add(property?.name, values[0])
    }
  }
  for (let index = 1; index <= 3; index += 1) {
    if (propertyOrder[index - 1]) add(propertyOrder[index - 1], variant?.[`option${index}`])
  }
  return selections
}

function normalizeVariantImages(candidate) {
  const properties = Array.isArray(candidate?.properties) ? candidate.properties : []
  const propertyOrder = properties.map((property) => canonicalVariationName(property?.name)).filter(Boolean).slice(0, 3)
  const result = []
  const seen = new Set()
  for (const variant of Array.isArray(candidate?.variants) ? candidate.variants : []) {
    const images = mergeImageUrls(variantImages(variant), MAX_VARIANT_IMAGES)
    if (!images.length) continue
    const selections = variantSelections(variant, propertyOrder)
    const key = `${JSON.stringify(selections)}|${images.join('|')}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ selections, images })
    if (result.length >= MAX_VARIANT_IMAGE_GROUPS) break
  }
  return result
}

function normalizeCategory(value) {
  const category = text(value, 80)
  return category || 'Geral'
}

function normalizedKey(value) {
  return canonicalKey(value).replace(/\s+/g, '-')
}

function productFingerprint(candidate, normalized) {
  const sku = canonicalKey(normalized.sku)
  if (sku) return `sku:${sku}`
  const externalId = canonicalKey(candidate?.external_id)
  if (externalId) return `external:${externalId}`
  const sourceUrl = text(candidate?.source_url, 2048)
  if (sourceUrl) return `url:${sourceUrl.toLowerCase()}`
  return `product:${normalizedKey(normalized.name)}:${normalized.price ?? ''}`
}

function blockingWarnings(normalized) {
  const warnings = []
  if (!normalized.name) warnings.push('missing_name')
  if (normalized.price == null) warnings.push('missing_price')
  return warnings
}

function completenessIssues(normalized, candidate) {
  const issues = [...blockingWarnings(normalized)]
  if (!normalized.images.length) issues.push('missing_image')
  if (!normalized.sku) issues.push('missing_sku')
  if (!text(candidate?.category, 80)) issues.push('missing_category')
  if (!normalized.description) issues.push('missing_description')
  return issues
}

function mergedCompletenessIssues(normalized) {
  const issues = [...blockingWarnings(normalized)]
  if (!normalized.images.length) issues.push('missing_image')
  if (!normalized.sku) issues.push('missing_sku')
  if (!normalized.category || normalized.category === 'Geral') issues.push('missing_category')
  if (!normalized.description) issues.push('missing_description')
  return issues
}

function confidenceFromIssues(issues) {
  const weights = {
    missing_name: 0.45,
    missing_price: 0.25,
    missing_image: 0.12,
    missing_description: 0.07,
    missing_category: 0.06,
    missing_sku: 0.05,
  }
  const penalty = issues.reduce((sum, issue) => sum + (weights[issue] || 0.03), 0)
  return Math.max(0, Math.min(1, Math.round((1 - penalty) * 100) / 100))
}

export function normalizeCandidate(candidate) {
  const normalized = {
    name: text(candidate?.title, 180),
    description: cleanDescription(candidate?.description),
    sku: text(candidate?.sku, 80),
    category: normalizeCategory(candidate?.category),
    brand: text(candidate?.brand, 100),
    price: candidatePrice(candidate),
    currency: text(candidate?.currency, 10).toUpperCase(),
    images: normalizeImages(candidate),
    variant_images: normalizeVariantImages(candidate),
    media_url: '',
    media_type: 'image',
    pack: '',
    variations: normalizeVariations(candidate),
    availability: text(candidate?.availability, 100),
    source_url: text(candidate?.source_url, 2048),
    source: text(candidate?.source, 80),
  }
  normalized.media_url = normalized.images[0] || ''
  const warnings = blockingWarnings(normalized)
  const issues = completenessIssues(normalized, candidate)
  return {
    fingerprint: productFingerprint(candidate, normalized),
    source_candidate_id: text(candidate?.__candidate_id, 120),
    normalized,
    warnings,
    confidence: confidenceFromIssues(issues),
  }
}

function richness(item) {
  const n = item.normalized
  return (n.images.length * 3) + (n.variant_images.length * 4) + (n.variations.length * 4) + (n.description ? 3 : 0) + (n.sku ? 2 : 0) + (n.price != null ? 4 : 0) + item.confidence * 10
}

function mergeVariations(values) {
  const groups = new Map()
  for (const variation of Array.isArray(values) ? values : []) {
    const name = canonicalVariationName(variation?.name)
    if (!name) continue
    const key = canonicalKey(name)
    if (!groups.has(key)) groups.set(key, { name, options: [] })
    const group = groups.get(key)
    const seen = new Set(group.options.map((option) => canonicalKey(option)))
    for (const raw of Array.isArray(variation?.options) ? variation.options : []) {
      const option = validOption(raw)
      const optionKey = canonicalKey(option)
      if (!option || !optionKey || seen.has(optionKey)) continue
      seen.add(optionKey)
      group.options.push(option)
      if (group.options.length >= 30) break
    }
  }
  const priority = { Cor: 0, Tamanho: 1 }
  return [...groups.values()]
    .filter((group) => group.options.length)
    .sort((a, b) => (priority[a.name] ?? 10) - (priority[b.name] ?? 10) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 5)
}

function selectionKey(selections) {
  if (!selections || typeof selections !== 'object') return ''
  return Object.entries(selections)
    .map(([name, option]) => [canonicalVariationName(name), validOption(option)])
    .filter(([name, option]) => name && option)
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([name, option]) => `${canonicalKey(name)}=${canonicalKey(option)}`)
    .join('|')
}

function mergeVariantImages(values) {
  const groups = new Map()
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== 'object') continue
    const selections = raw.selections && typeof raw.selections === 'object' ? raw.selections : {}
    const key = selectionKey(selections) || `images:${mergeImageUrls(raw.images, MAX_VARIANT_IMAGES).join('|')}`
    const images = mergeImageUrls(raw.images, MAX_VARIANT_IMAGES)
    if (!images.length) continue
    if (!groups.has(key)) groups.set(key, { selections, images: [] })
    const group = groups.get(key)
    group.images = mergeImageUrls([...group.images, ...images], MAX_VARIANT_IMAGES)
    if (groups.size >= MAX_VARIANT_IMAGE_GROUPS && !groups.has(key)) break
  }
  return [...groups.values()].slice(0, MAX_VARIANT_IMAGE_GROUPS)
}

function preferMeaningfulCategory(primary, secondary) {
  const first = text(primary, 80)
  const second = text(secondary, 80)
  if (first && first !== 'Geral') return first
  if (second && second !== 'Geral') return second
  return first || second || 'Geral'
}

function mergeNormalizedItems(previous, incoming) {
  const base = richness(incoming) > richness(previous) ? incoming : previous
  const other = base === incoming ? previous : incoming
  const a = base.normalized
  const b = other.normalized
  const images = mergeImageUrls([...a.images, ...b.images])
  const variantImages = mergeVariantImages([...a.variant_images, ...b.variant_images])
  const normalized = {
    ...a,
    name: a.name || b.name,
    description: a.description || b.description,
    sku: a.sku || b.sku,
    category: preferMeaningfulCategory(a.category, b.category),
    brand: a.brand || b.brand,
    price: a.price ?? b.price,
    currency: a.currency || b.currency,
    images,
    variant_images: variantImages,
    media_url: images[0] || a.media_url || b.media_url || '',
    media_type: images.length ? 'image' : (a.media_type || b.media_type || 'image'),
    pack: a.pack || b.pack,
    variations: mergeVariations([...a.variations, ...b.variations]),
    availability: a.availability || b.availability,
    source_url: a.source_url || b.source_url,
    source: a.source || b.source,
  }
  const warnings = blockingWarnings(normalized)
  return {
    ...base,
    normalized,
    warnings,
    confidence: confidenceFromIssues(mergedCompletenessIssues(normalized)),
  }
}

export function normalizeCandidates(candidates) {
  const byFingerprint = new Map()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const item = normalizeCandidate(candidate)
    if (!item.normalized.name) continue
    const previous = byFingerprint.get(item.fingerprint)
    byFingerprint.set(item.fingerprint, previous ? mergeNormalizedItems(previous, item) : item)
  }
  const products = [...byFingerprint.values()]
  return {
    products,
    inputCount: Array.isArray(candidates) ? candidates.length : 0,
    duplicateCount: Math.max(0, (Array.isArray(candidates) ? candidates.length : 0) - products.length),
    warningCount: products.filter((item) => item.warnings.length > 0).length,
  }
}
