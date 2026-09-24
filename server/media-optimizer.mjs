import sharp from 'sharp'

export const MEDIA_VARIANTS = [
  { name: 'thumb', max: 400, quality: 78 },
  { name: 'medium', max: 900, quality: 82 },
  { name: 'large', max: 1600, quality: 84 },
]

export async function optimizeImageBuffer(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  if (!input.length) throw new Error('Imagem vazia.')
  const base = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 }).rotate()
  const metadata = await base.metadata()
  if (!metadata.width || !metadata.height) throw new Error('Não foi possível identificar as dimensões da imagem.')

  const variants = []
  for (const variant of MEDIA_VARIANTS) {
    const pipeline = sharp(input, { failOn: 'none', limitInputPixels: 100_000_000 })
      .rotate()
      .resize({
        width: variant.max,
        height: variant.max,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: variant.quality, effort: 4 })
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    variants.push({
      name: variant.name,
      mimeType: 'image/webp',
      width: info.width,
      height: info.height,
      byteSize: data.length,
      data,
    })
  }

  return {
    original: { width: metadata.width, height: metadata.height, format: metadata.format || '' },
    variants,
  }
}

export async function saveImageVariants(query, assetId, variants) {
  for (const variant of variants || []) {
    await query(
      `INSERT INTO media_asset_variants (asset_id,variant,mime_type,byte_size,width,height,data)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (asset_id,variant)
       DO UPDATE SET mime_type=EXCLUDED.mime_type,byte_size=EXCLUDED.byte_size,width=EXCLUDED.width,height=EXCLUDED.height,data=EXCLUDED.data`,
      [assetId, variant.name, variant.mimeType, variant.byteSize, variant.width, variant.height, variant.data],
    )
  }
}

export function mediaVariantFromQuery(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'original') return ''
  return ['thumb', 'medium', 'large'].includes(normalized) ? normalized : 'large'
}
