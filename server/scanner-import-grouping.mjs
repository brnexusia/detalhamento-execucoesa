import crypto from 'node:crypto'
import { canonicalVariationName } from './scanner-normalizer.mjs'

function text(value, max = 2048) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function canonical(value) {
  return text(value, 300)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const VARIANT_QUERY = /^(?:variant|variant_id|variation|variation_id|variacao|variacao_id|id_variacao|sku|color|colour|cor|size|tamanho|tam|option\d*|opcao\d*|attribute_.+|atributo_.+)$/i
const TRACKING_QUERY = /^(?:utm_.+|fbclid|gclid|msclkid|ref|referrer)$/i

export function canonicalImportProductUrl(value) {
  const raw = text(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (VARIANT_QUERY.test(key) || TRACKING_QUERY.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return ''
  }
}

function productSpecificUrl(value) {
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (path === '/') return false
    if (/\/(?:catalogo|catalog|loja|shop|produtos|products|categoria|category|collection|collections|busca|search)$/i.test(path)) return false
    return true
  } catch {
    return false
  }
}

function variationEvidence(data) {
  return Array.isArray(data?.variations) && data.variations.some((group) => Array.isArray(group?.options) && group.options.length)
}

export function importParentKey(data) {
  const input = data && typeof data === 'object' ? data : {}
  const sourceUrl = canonicalImportProductUrl(input.source_url)
  if (sourceUrl && productSpecificUrl(sourceUrl)) return `url:${sourceUrl.toLowerCase()}`

  let origin = ''
  try { origin = sourceUrl ? new URL(sourceUrl).origin.toLowerCase() : '' } catch {}
  const name = canonical(input.name)
  const category = canonical(input.category)
  const brand = canonical(input.brand)
  if (name && variationEvidence(input)) return `title:${origin}:${name}:${category}:${brand}`

  const sku = canonical(input.sku)
  if (sku) return `sku:${origin}:${sku}`
  return `product:${origin}:${name}:${Number(input.price) || ''}`
}

export function importParentHash(data) {
  return crypto.createHash('sha256').update(importParentKey(data)).digest('hex')
}

function uniqueUrls(values, max = 40) {
  const result = []
  const seen = new Set()
  for (const raw of values) {
    const value = text(raw, 1000)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= max) break
  }
  return result
}

function mergeVariationGroups(rows) {
  const groups = new Map()
  for (const row of rows) {
    for (const raw of Array.isArray(row?.variations) ? row.variations : []) {
      const name = canonicalVariationName(raw?.name)
      if (!name) continue
      const key = canonical(name)
      if (!groups.has(key)) groups.set(key, { name, options: [], seen: new Set() })
      const group = groups.get(key)
      for (const optionRaw of Array.isArray(raw?.options) ? raw.options : []) {
        const option = text(optionRaw, 60)
        if (!option) continue
        const optionKey = canonical(option)
        if (!optionKey || group.seen.has(optionKey)) continue
        group.seen.add(optionKey)
        group.options.push(option)
        if (group.options.length >= 30) break
      }
    }
  }
  const priority = { Cor: 0, Tamanho: 1 }
  return [...groups.values()]
    .map(({ name, options }) => ({ name, options }))
    .filter((group) => group.options.length)
    .sort((a, b) => (priority[a.name] ?? 10) - (priority[b.name] ?? 10) || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 5)
}

function mergeVariantImages(rows) {
  const result = []
  const seen = new Set()
  for (const row of rows) {
    for (const raw of Array.isArray(row?.variant_images) ? row.variant_images : []) {
      const images = uniqueUrls(Array.isArray(raw?.images) ? raw.images : [], 8)
      if (!images.length) continue
      const selections = raw?.selections && typeof raw.selections === 'object' ? raw.selections : {}
      const key = `${JSON.stringify(selections)}|${images.join('|')}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ selections, images })
      if (result.length >= 80) return result
    }
  }
  return result
}

function richness(data) {
  const images = Array.isArray(data?.images) ? data.images.length : 0
  const variantImages = Array.isArray(data?.variant_images) ? data.variant_images.length : 0
  const variations = Array.isArray(data?.variations) ? data.variations.reduce((sum, group) => sum + (group?.options?.length || 0), 0) : 0
  return (images * 5) + (variantImages * 4) + (variations * 3) + (text(data?.description, 2000) ? 5 : 0) +
    (text(data?.category, 80) && text(data?.category, 80) !== 'Geral' ? 2 : 0) + (text(data?.brand, 100) ? 2 : 0)
}

export function mergeImportParentProducts(values) {
  const rows = (Array.isArray(values) ? values : []).filter((value) => value && typeof value === 'object')
  if (!rows.length) return null
  const base = [...rows].sort((a, b) => richness(b) - richness(a))[0]
  const variantImages = mergeVariantImages(rows)
  const images = uniqueUrls(rows.flatMap((row) => [
    ...(Array.isArray(row.images) ? row.images : []),
    ...(Array.isArray(row.variant_images) ? row.variant_images.flatMap((item) => Array.isArray(item?.images) ? item.images : []) : []),
    row.media_type !== 'video' ? row.media_url : '',
  ]))
  const variations = mergeVariationGroups(rows)
  const skuValues = [...new Map(rows.map((row) => text(row.sku, 80)).filter(Boolean).map((sku) => [sku.toLowerCase(), sku])).values()]
  const prices = rows.map((row) => Number(row.price)).filter((price) => Number.isFinite(price) && price > 0)
  const sourceUrl = canonicalImportProductUrl(base.source_url) || text(base.source_url)
  const mediaUrl = images[0] || (base.media_type === 'video' ? text(base.media_url, 1000) : '')

  return {
    ...base,
    name: text(base.name, 180),
    description: text(base.description, 2000),
    sku: skuValues.length === 1 ? skuValues[0] : '',
    price: prices.length ? Math.min(...prices) : base.price,
    images,
    variant_images: variantImages,
    media_url: mediaUrl,
    media_type: base.media_type === 'video' && !images.length ? 'video' : 'image',
    variations,
    source_url: sourceUrl,
  }
}
