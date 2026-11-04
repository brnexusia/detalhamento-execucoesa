import sharp from 'sharp'

// Preserve small camera photos byte-for-byte; normalize large files and formats
// that are not consistently rendered by browsers (especially HEIC/HEIF).
export const MAX_CATALOG_UPLOAD_BYTES = 30 * 1024 * 1024
export const PHOTO_OPTIMIZE_THRESHOLD_BYTES = 2 * 1024 * 1024
const MAX_PHOTO_PIXELS = 100_000_000
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i
const VIDEO_EXT = /\.(?:mp4|webm|mov)$/i

function uploadError(message, statusCode = 415) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function nameOf(file) { return String(file?.originalname || '').trim() }
function mimeOf(file) { return String(file?.mimetype || '').split(';')[0].toLowerCase().trim() }

export function acceptsCatalogMediaFile(file) {
  const mime = mimeOf(file)
  const name = nameOf(file)
  return IMAGE_MIMES.has(mime) || VIDEO_MIMES.has(mime) ||
    (['application/octet-stream', '', 'binary/octet-stream'].includes(mime) &&
      (IMAGE_EXT.test(name) || VIDEO_EXT.test(name)))
}

export function detectCatalogImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase()
    if (['avif', 'avis'].includes(brand)) return 'image/avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  }
  return null
}

export async function prepareCatalogMedia(file) {
  const bytes = file?.buffer
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw uploadError('O arquivo está vazio. Escolha outra foto.', 400)
  if (bytes.length > MAX_CATALOG_UPLOAD_BYTES)
    throw uploadError('O arquivo ultrapassa 30 MB. Escolha uma foto menor.', 413)

  const detected = detectCatalogImageType(bytes)
  const declared = mimeOf(file)
  if (!detected) {
    if (VIDEO_MIMES.has(declared) ||
        (declared === 'application/octet-stream' && VIDEO_EXT.test(nameOf(file)))) {
      return { buffer: bytes, mimeType: VIDEO_MIMES.has(declared) ? declared :
        /\.mov$/i.test(nameOf(file)) ? 'video/quicktime' :
          /\.webm$/i.test(nameOf(file)) ? 'video/webm' : 'video/mp4', type: 'video' }
    }
    throw uploadError('Formato de foto não reconhecido. Use JPG, PNG, WEBP, AVIF ou HEIC.')
  }

  // Do not serve data declared as a video from a valid image signature.
  if (!IMAGE_MIMES.has(detected)) throw uploadError('Formato de foto não suportado.')
  const mustConvert = ['image/heic', 'image/heif', 'image/avif'].includes(detected)
  const shouldOptimize = mustConvert || (bytes.length > PHOTO_OPTIMIZE_THRESHOLD_BYTES && detected !== 'image/gif')
  if (!shouldOptimize) return { buffer: bytes, mimeType: detected, type: 'image' }

  try {
    const source = sharp(bytes, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: 'error', animated: false })
    // Sharp auto-rotates using EXIF and drops metadata in the normalized result.
    const pipeline = source.rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    const outputType = detected === 'image/png' || detected === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const normalized = outputType === 'image/webp'
      ? await pipeline.webp({ quality: 82, effort: 4 }).toBuffer()
      : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    if (!normalized.length) throw Error('empty normalized image')
    if (!mustConvert && normalized.length >= bytes.length)
      return { buffer: bytes, mimeType: detected, type: 'image' }
    return { buffer: normalized, mimeType: outputType, type: 'image' }
  } catch (error) {
    if (mustConvert) throw uploadError('Não foi possível converter esta foto HEIC/AVIF. Tente exportá-la como JPG.')
    throw uploadError('Não foi possível processar esta imagem. Tente outra foto JPG ou PNG.')
  }
}
