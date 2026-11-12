import sharp from 'sharp'

const supported = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const targets = [320, 960]

/**
 * Variants are optional optimizations, never substitutes for the original asset.
 * Only raster formats are processed; no SVG, GIF, animation or video conversion.
 */
export async function generateMediaVariants(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !supported.has(String(mimeType || '').toLowerCase())) return []
  let metadata
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: 40_000_000, failOn: 'error', animated: false,
    }).metadata()
  } catch {
    // Arquivo corrompido ou MIME incorreto: preservar original sem abortar lote/worker.
    return []
  }
  if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) return []
  // Processar uma resolução por vez limita picos de RAM no worker/CLI.
  // 960 pode ter largura real menor (ex.: foto de 750px) sem upscaling.
  if (metadata.width <= 320) return []
  const variants = []
  for (const width of targets) {
    const bytes = await sharp(buffer, {
      limitInputPixels: 40_000_000, failOn: 'error', animated: false,
    }).rotate().resize({ width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 3 }).toBuffer()
    if (bytes.length < buffer.length) {
      variants.push({ width, mimeType: 'image/webp', bytes })
    }
  }
  return variants
}

export function requestedMediaWidth(value) {
  return value === '320' || value === '960' ? Number(value) : null
}
