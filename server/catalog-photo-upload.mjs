import sharp from 'sharp'
import convertHeic from 'heic-convert'

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

// Identify media by its container signature, never by client-controlled MIME alone.
// This header check is not a full codec or malware scan.
export function detectCatalogVideoType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const header = buffer.subarray(4, Math.min(buffer.length, 2048))
    if (header.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))) return 'video/webm'
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const size = buffer.readUInt32BE(0)
    if (size < 16 || size > buffer.length) return null
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase()
    if (brand === 'qt  ') return 'video/quicktime'
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42',
      'avc1', 'dash', 'm4v ', 'm4vh', '3gp4', '3gp5'].includes(brand)) return 'video/mp4'
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
    const generic = ['', 'application/octet-stream', 'binary/octet-stream'].includes(declared)
    const videoRequested = VIDEO_MIMES.has(declared) || (generic && VIDEO_EXT.test(nameOf(file)))
    if (videoRequested) {
      const actual = detectCatalogVideoType(bytes)
      if (!actual) throw uploadError('Vídeo inválido ou não suportado. Envie MP4, MOV ou WEBM válido.')
      return { buffer: bytes, mimeType: actual, type: 'video' }
    }
    throw uploadError('Formato de foto não reconhecido. Use JPG, PNG, WEBP, AVIF ou HEIC.')
  }

  // Do not serve data declared as a video from a valid image signature.
  if (!IMAGE_MIMES.has(detected)) throw uploadError('Formato de foto não suportado.')

  // Prebuilt Sharp/libvips decodes AVIF but often lacks patented HEVC for iPhone HEIC.
  // Decode HEIC using libheif WASM, then shrink the JPEG with Sharp. Bound the
  // input size to avoid very large allocations in the synchronous WASM decoder.
  if (detected === 'image/heic' || detected === 'image/heif') {
    if (bytes.length > 12 * 1024 * 1024) {
      throw uploadError('Foto HEIC acima de 12 MB. Exporte como JPG ou reduza o arquivo.', 413)
    }
    try {
      const decoded = Buffer.from(await convertHeic({ buffer: bytes, format: 'JPEG', quality: 0.82 }))
      const normalized = await sharp(decoded, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: 'error' })
        .rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      return { buffer: normalized, mimeType: 'image/jpeg', type: 'image' }
    } catch {
      throw uploadError('Não foi possível converter a foto HEIC. Exporte como JPG e tente novamente.')
    }
  }

  const mustConvert = detected === 'image/avif'
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
