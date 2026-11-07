import crypto from 'node:crypto'

// Minimal request lifecycle trace for uploads only, without filenames,
// tokens, cookies, file contents or personal data in the logs.
export function traceUpload(kind, options = {}) {
  const now = options.now || (() => Date.now())
  const newId = options.newId || (() => crypto.randomUUID())
  return (req, res, next) => {
    const id = newId()
    const started = now()
    const rawLength = Number(req.headers?.['content-length'])
    const bytes = Number.isSafeInteger(rawLength) && rawLength >= 0 ? rawLength : null
    res.setHeader('X-Upload-Request-ID', id)
    const summary = { id, kind, bytes }
    console.info('[upload] started', summary)
    let finished = false
    res.once('finish', () => {
      finished = true
      console.info('[upload] finished', { ...summary, status: res.statusCode, elapsedMs: now() - started })
    })
    res.once('close', () => {
      if (!finished) {
        console.warn('[upload] connection closed before response', {
          ...summary, status: res.statusCode, elapsedMs: now() - started,
        })
      }
    })
    next()
  }
}
