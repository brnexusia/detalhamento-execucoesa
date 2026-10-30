import sharp from 'sharp'

const supported = new Set(['image/jpeg', 'image/png', 'image/webp'])
const targets = [320, 960]

/**
 * Variants are optional optimizations, never substitutes for the original asset.
 * Only raster formats are processed; no SVG, GIF, animation or video conversion.
 */
export async function generateMediaVariants(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !supported.has(String(mimeType || '').toLowerCase())) return []
  const metadata = await sharp(buffer, {
    limitInputPixels: 40_000_000, failOn: 'error', animated: false,
  }).metadata()
  if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) return []
  return Promise.all(targets.filter(width => metadata.width > width).map(async width => {
    const bytes = await sharp(buffer, {
      limitInputPixels: 40_000_000, failOn: 'error', animated: false,
    }).rotate().resize({ width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 }).toBuffer()
    if (bytes.length >= buffer.length) return null
    return { width, mimeType: 'image/webp', bytes }
  })).then(values => values.filter(Boolean))
}

export function requestedMediaWidth(value) {
  return value === '320' || value === '960' ? Number(value) : null
}
