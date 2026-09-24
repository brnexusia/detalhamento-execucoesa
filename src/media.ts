export type MediaVariantSize = 'thumb' | 'medium' | 'large' | 'original'

export function optimizedMediaUrl(url: string | undefined | null, size: MediaVariantSize) {
  const value = String(url || '').trim()
  if (!/^\/media\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(value)) return value
  const [base, query = ''] = value.split('?')
  const params = new URLSearchParams(query)
  params.set('size', size)
  return `${base}?${params.toString()}`
}
