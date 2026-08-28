import { load } from 'cheerio'

const COLOR_NAMES = new Set(['cor', 'cores', 'color', 'colors', 'colour', 'colours'])
const SIZE_NAMES = new Set(['tamanho', 'tamanhos', 'tam', 'size', 'sizes', 'numero', 'número', 'numeracao', 'numeração'])
const IGNORED_OPTIONS = new Set(['default title', 'padrão', 'padrao', 'default', 'único', 'unico', 'one size'])

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
  if (COLOR_NAMES.has(key)) return 'Cor'
  if (SIZE_NAMES.has(key)) return 'Tamanho'
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

  const propertyOrder = properties
    .map((property) => canonicalVariationName(property?.name))
    .filter(Boolean)
    .slice(0, 3)

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

function normalizeImages(candidate) {
  const result = []
  const seen = new Set()
  for (const raw of Array.isArray(candidate?.images) ? candidate.images : []) {
    try {
      const url = new URL(String(raw))
      if (!['http:', 'https:'].includes(url.protocol)) continue
      url.hash = ''
      const value = url.toString()
      if (seen.has(value)) continue
      seen.add(value)
      result.push(value)
    } catch {}
    if (result.length >= 12) break
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

function warningList(normalized, candidate) {
  const warnings = []
  if (normalized.price == null) warnings.push('missing_price')
  if (!normalized.images.length) warnings.push('missing_image')
  if (!normalized.sku) warnings.push('missing_sku')
  if (!text(candidate?.category, 80)) warnings.push('missing_category')
  if (!normalized.description) warnings.push('missing_description')
  if (!normalized.name) warnings.push('missing_name')
  return warnings
}

function confidenceFromWarnings(warnings) {
  const weights = {
    missing_name: 0.45,
    missing_price: 0.25,
    missing_image: 0.12,
    missing_description: 0.07,
    missing_category: 0.06,
    missing_sku: 0.05,
  }
  const penalty = warnings.reduce((sum, warning) => sum + (weights[warning] || 0.03), 0)
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
    media_url: '',
    media_type: 'image',
    pack: '',
    variations: normalizeVariations(candidate),
    availability: text(candidate?.availability, 100),
    source_url: text(candidate?.source_url, 2048),
    source: text(candidate?.source, 80),
  }
  normalized.media_url = normalized.images[0] || ''
  const warnings = warningList(normalized, candidate)
  return {
    fingerprint: productFingerprint(candidate, normalized),
    normalized,
    warnings,
    confidence: confidenceFromWarnings(warnings),
  }
}

function richness(item) {
  const n = item.normalized
  return (n.images.length * 3) + (n.variations.length * 4) + (n.description ? 3 : 0) + (n.sku ? 2 : 0) + (n.price != null ? 4 : 0) + item.confidence * 10
}

export function normalizeCandidates(candidates) {
  const byFingerprint = new Map()
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const item = normalizeCandidate(candidate)
    if (!item.normalized.name) continue
    const previous = byFingerprint.get(item.fingerprint)
    if (!previous || richness(item) > richness(previous)) byFingerprint.set(item.fingerprint, item)
  }
  const products = [...byFingerprint.values()]
  return {
    products,
    inputCount: Array.isArray(candidates) ? candidates.length : 0,
    duplicateCount: Math.max(0, (Array.isArray(candidates) ? candidates.length : 0) - products.length),
    warningCount: products.filter((item) => item.warnings.length > 0).length,
  }
}
