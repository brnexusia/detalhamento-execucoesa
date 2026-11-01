/**
 * Otimização opcional de mídias, fora da resposta do upload.
 *
 * A mídia original já deve estar persistida antes de enfileirar. Em caso de
 * erro ou sobrecarga, ela continua disponível no endpoint /media/:id.
 * O processamento é limitado para evitar picos de RAM com arquivos grandes.
 */
export function createMediaVariantQueue({
  generate,
  persist,
  onError = () => {},
  maxPending = 3,
}) {
  if (typeof generate !== 'function' || typeof persist !== 'function') {
    throw new TypeError('generate e persist são obrigatórios')
  }
  const waiting = []
  let working = false

  async function drain() {
    if (working) return
    working = true
    try {
      while (waiting.length > 0) {
        const job = waiting.shift()
        try {
          const variants = await generate(job.buffer, job.mimeType)
          for (const variant of variants) await persist(job.assetId, variant)
          job.resolve(true)
        } catch (error) {
          try { onError(error) } catch { /* log nunca pode interromper a fila */ }
          job.resolve(false)
        }
      }
    } finally {
      working = false
    }
  }

  return {
    enqueue(assetId, buffer, mimeType) {
      if (waiting.length >= maxPending) {
        return { accepted: false, done: Promise.resolve(false) }
      }
      let resolve
      const done = new Promise((ok) => { resolve = ok })
      waiting.push({ assetId, buffer, mimeType, resolve })
      setImmediate(() => { void drain() })
      return { accepted: true, done }
    },
  }
}
