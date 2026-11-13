import path from 'node:path'
import express from 'express'

/**
 * Serve fingerprinted assets exactly as files. If an old browser requests a chunk
 * removed by the latest deploy, respond 404: serving index.html as JavaScript
 * produces a misleading MIME error and traps React.lazy in the recovery page.
 */
export function installUiStaticRoutes(app, distDir) {
  app.use(express.static(distDir, {
    index: false,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (/shopvax-ui-version\\.json$|shopvax-release-sha\\.txt$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
      }
    },
  }))

  // Static files are not SPA routes: do not return HTML for a missing JS/CSS chunk.
  app.use('/assets', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.status(404).type('text/plain').send('Asset not found')
  })

  app.get('*', (_req, res) => {
    // Prevent an old index from referencing chunks deleted by the next deploy.
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}
