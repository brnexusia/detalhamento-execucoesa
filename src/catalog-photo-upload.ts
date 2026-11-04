// Prepara fotos de câmera antes de atravessar proxies com limites de corpo HTTP.
// Não toca em vídeos nem em imagens pequenas; o backend valida o conteúdo real.
const LARGE_PHOTO = 700 * 1024
// Keep multipart payload below common 1 MB reverse-proxy limits.
const NETWORK_PHOTO_LIMIT = 950 * 1024
const MAX_UPLOAD = 30 * 1024 * 1024
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i
const VIDEO_EXT = /\.(mp4|webm|mov)$/i

export function isCatalogPhoto(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || IMAGE_EXT.test(file.name)
}

function supportedPhoto(file: File): boolean {
  return /^(image\/(jpeg|png|webp|gif|avif|heic|heif))$/i.test(file.type) ||
    ((file.type === '' || file.type === 'application/octet-stream') && IMAGE_EXT.test(file.name))
}

function imageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported image decoder')) }
    image.src = url
  })
}

async function renderPhoto(image: HTMLImageElement, size: number, quality: number, mime: string): Promise<Blob> {
  const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas unavailable')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality))
  canvas.width = 0
  canvas.height = 0
  if (!blob || !blob.size || !/^image\/(jpeg|webp)$/.test(blob.type)) throw new Error('image encoder unavailable')
  return blob
}

export async function prepareCatalogPhoto(file: File): Promise<File> {
  if (file.type.toLowerCase().startsWith('video/') || VIDEO_EXT.test(file.name)) {
    if (file.size > MAX_UPLOAD) throw new Error('O vídeo ultrapassa 30 MB.')
    return file
  }
  if (!isCatalogPhoto(file) || !supportedPhoto(file)) {
    throw new Error('Selecione uma foto JPG, PNG, WEBP, AVIF ou HEIC.')
  }
  if (!file.size) throw new Error('Esta foto está vazia. Escolha outra imagem.')
  const convert = /\.(heic|heif|avif)$/i.test(file.name) || /image\/(heic|heif|avif)/i.test(file.type)
  if (!convert && file.size <= LARGE_PHOTO) return file
  // GIF animado pequeno deve permanecer animado; arquivos grandes precisam
  // ser exportados em formato de imagem estática para não exceder o proxy.
  if (/image\/gif/i.test(file.type) && file.size <= NETWORK_PHOTO_LIMIT) return file

  try {
    const image = await imageFromFile(file)
    const mime = /image\/(png|webp)/i.test(file.type) ? 'image/webp' : 'image/jpeg'
    let optimized = await renderPhoto(image, 2200, 0.82, mime)
    if (optimized.size > NETWORK_PHOTO_LIMIT) optimized = await renderPhoto(image, 1600, 0.74, mime)
    if (optimized.size > NETWORK_PHOTO_LIMIT) optimized = await renderPhoto(image, 1200, 0.66, mime)
    if (optimized.size > NETWORK_PHOTO_LIMIT) throw Error('too large after encoding')
    if (!convert && file.size <= NETWORK_PHOTO_LIMIT && optimized.size >= file.size) return file
    const ext = optimized.type === 'image/webp' ? 'webp' : 'jpg'
    const stem = file.name.replace(/\.[^.]+$/, '').slice(0, 150) || 'foto-produto'
    return new File([optimized], stem + '.' + ext, { type: optimized.type, lastModified: file.lastModified })
  } catch {
    // Chrome/Firefox podem não decodificar HEIC, mas o servidor pode convertê-lo.
    if (file.size <= NETWORK_PHOTO_LIMIT) return file
    throw new Error('Esta foto é grande demais para enviar. Exporte como JPG ou reduza o tamanho e tente novamente.')
  }
}
