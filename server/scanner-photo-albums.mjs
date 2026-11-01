import sharp from 'sharp'

// Shared Google Photos pages expose some public photo URLs in their HTML.
// Private albums and JS-only pages cannot be read with a server-side link.
const GOOGLE_PHOTOS_HOSTS = new Set(['photos.google.com', 'photos.app.goo.gl'])
const GOOGLE_IMAGE_HOST = /^(?:lh[3-6]\.googleusercontent\.com|photos\.googleusercontent\.com)$/
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif|gif)$/i
const MAX_ALBUM_PHOTOS = 120
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_STORED_BYTES = 150 * 1024 * 1024

function parsedUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch { return null }
}

export function sharedPhotoSourceKind(value) {
  const url = parsedUrl(value)
  if (!url) return ''
  const host = url.hostname.toLowerCase()
  if (GOOGLE_PHOTOS_HOSTS.has(host)) return 'google-photos'
  if (IMAGE_EXTENSION.test(url.pathname) || (GOOGLE_IMAGE_HOST.test(host) && url.pathname.length > 40)) return 'image-link'
  return ''
}

function decodeAlbumHtml(html) {
  return String(html || '')
    .replace(/\\u003[dD]/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\x3[dD]/g, '=')
    .replace(/\\x26/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
}

function imageKey(url) {
  const pathname = url.pathname.replace(/=(?:w|h|s)\d+[A-Za-z0-9-]*$/, '')
  return url.hostname.toLowerCase() + pathname
}

function preferredPixels(url) {
  const dimensions = [...url.pathname.matchAll(/(?:[=\-])(?:w|h|s)(\d{2,5})/g)].map((match) => Number(match[1]))
  return dimensions.length ? Math.max(...dimensions) : 0
}

export function googlePhotosImageUrls(html, limit = MAX_ALBUM_PHOTOS) {
  const raw = decodeAlbumHtml(html)
  const pattern = /https?:\/\/(?:lh[3-6]\.googleusercontent\.com|photos\.googleusercontent\.com)\/[^\s"'<>\\]+/gi
  const images = new Map()
  for (const matched of raw.matchAll(pattern)) {
    const url = parsedUrl(matched[0].replace(/[),;\]}]+$/, ''))
    if (!url || url.protocol !== 'https:' || !GOOGLE_IMAGE_HOST.test(url.hostname.toLowerCase())) continue
    // Do not import Google account avatars, tracking pixels or tiny icons.
    const photoPath = /^\/(?:pw|p)\//i.test(url.pathname) ||
      /^\/[A-Za-z0-9_-]{64,}/.test(url.pathname)
    if (!photoPath) continue
    const key = imageKey(url)
    const existing = images.get(key)
    if (!existing || preferredPixels(url) > preferredPixels(new URL(existing))) images.set(key, url.toString())
    if (images.size >= MAX_ALBUM_PHOTOS * 3) break
  }
  return [...images.values()].slice(0, Math.max(1, Math.min(MAX_ALBUM_PHOTOS, Number(limit) || MAX_ALBUM_PHOTOS)))
}

async function savePhoto(url, request, onImage, filename) {
  const response = await request(url, {
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.2',
    responseType: 'buffer',
    maxBytes: MAX_IMAGE_BYTES,
    maxOutputBytes: MAX_IMAGE_BYTES,
  })
  if (!response?.ok) throw new Error('Imagem pública indisponível.')
  const buffer = response.buffer
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Imagem inválida ou muito grande.')
  // Sharp inspects real image bytes rather than trusting Content-Type headers.
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
  const meta = await image.metadata()
  if (Number(meta.width || 0) < 220 || Number(meta.height || 0) < 220) throw new Error('Miniatura insuficiente.')
  const optimized = await image.rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 }).toBuffer()
  if (optimized.length > 5 * 1024 * 1024) throw new Error('Imagem convertida excedeu o limite.')
  const stored = await onImage(optimized, 'image/webp', filename)
  if (!/^\/media\/[A-Za-z0-9_-]+$/.test(String(stored || ''))) throw new Error('A imagem não pôde ser salva no catálogo.')
  return { url: stored, bytes: optimized.length }
}

export async function collectSharedPhotos(sourceUrl, { request, onImage, onBatch, onProgress, maxProducts = MAX_ALBUM_PHOTOS, collectInMemory = true } = {}) {
  if (typeof request !== 'function' || typeof onImage !== 'function') throw new Error('Importação de fotos não configurada no servidor.')
  const kind = sharedPhotoSourceKind(sourceUrl)
  if (!kind) throw new Error('Informe um álbum público do Google Fotos ou um link direto de imagem.')
  const safeMax = Math.max(1, Math.min(MAX_ALBUM_PHOTOS, Number(maxProducts) || MAX_ALBUM_PHOTOS))
  let imageUrls = []
  let albumUrl = sourceUrl

  if (kind === 'google-photos') {
    const response = await request(sourceUrl, { accept: 'text/html,application/xhtml+xml', maxBytes: 8 * 1024 * 1024 })
    if (!response?.ok) throw new Error('Álbum inacessível. Ative o compartilhamento por link e tente novamente.')
    const finalUrl = parsedUrl(response.url || sourceUrl)
    if (!finalUrl || finalUrl.hostname.toLowerCase() !== 'photos.google.com') {
      throw new Error('O link não direciona para um álbum público do Google Fotos.')
    }
    albumUrl = finalUrl.toString()
    if (!String(response.contentType || '').includes('html')) throw new Error('O link não retornou um álbum legível.')
    imageUrls = googlePhotosImageUrls(response.body, safeMax)
    if (!imageUrls.length) throw new Error('Nenhuma foto pública foi encontrada no álbum. Confirme a opção Compartilhar por link. Alguns álbuns exigem acesso autenticado e não podem ser importados por URL.')
  } else {
    imageUrls = [sourceUrl]
  }

  const candidates = []
  let storedBytes = 0
  let accepted = 0
  let skipped = 0
  for (let i = 0; i < imageUrls.length; i += 1) {
    if (accepted >= safeMax || storedBytes >= MAX_TOTAL_STORED_BYTES) break
    try {
      const saved = await savePhoto(imageUrls[i], request, onImage, `foto-album-${String(i + 1).padStart(3, '0')}.webp`)
      storedBytes += saved.bytes
      accepted += 1
      const candidate = {
        source_url: `${albumUrl.split('#')[0]}#foto-${String(i + 1).padStart(4, '0')}`,
        external_id: `foto-${String(i + 1).padStart(4, '0')}`,
        title: `Foto importada ${String(i + 1).padStart(3, '0')}`,
        description: '',
        category: 'Geral',
        images: [saved.url],
        price: null,
        currency: 'BRL',
        source: kind === 'google-photos' ? 'google-photos-shared' : 'public-image-url',
      }
      if (collectInMemory) candidates.push(candidate)
      if (typeof onBatch === 'function') await onBatch([candidate], { candidateCount: accepted })
    } catch {
      skipped += 1
    }
    if ((i + 1) % 10 === 0 || i + 1 === imageUrls.length) {
      await onProgress?.({ progress: Math.min(90, 10 + Math.round(80 * (i + 1) / imageUrls.length)), pagesScanned: 1, candidates: accepted, platform: kind })
    }
  }
  if (!accepted) throw new Error('Nenhuma foto pôde ser baixada. O link deve ser público e as imagens precisam estar acessíveis.')
  await onProgress?.({ progress: 95, pagesScanned: 1, candidates: accepted, platform: kind })
  return { platform: kind, pagesScanned: 1, candidateCount: accepted, skipped, candidates }
}
