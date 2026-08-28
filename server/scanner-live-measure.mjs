import assert from 'node:assert/strict'
import { collectCatalog } from './scanner-collector.mjs'

const sourceUrl = process.env.LIVE_SCANNER_URL || 'https://books.toscrape.com/'
const startedAt = Date.now()
const result = await collectCatalog(sourceUrl, {
  maxProducts: 200,
  maxPages: 700,
  onProgress: async ({ progress, pagesScanned, candidates, platform }) => {
    if (progress % 15 === 0 || progress >= 90) {
      console.log(`[live-scanner] ${progress}% platform=${platform || result?.platform || ''} pages=${pagesScanned || 0} candidates=${candidates || 0}`)
    }
  },
})

const candidates = Array.isArray(result.candidates) ? result.candidates : []
const withPrice = candidates.filter((item) => Number.isFinite(Number(item.price)) && Number(item.price) > 0)
const withImage = candidates.filter((item) => Array.isArray(item.images) && item.images.length > 0)

console.log(JSON.stringify({
  sourceUrl,
  platform: result.platform,
  pagesScanned: result.pagesScanned,
  candidates: candidates.length,
  withPrice: withPrice.length,
  withImage: withImage.length,
  elapsedMs: Date.now() - startedAt,
  samples: candidates.slice(0, 3).map((item) => ({ title: item.title, price: item.price, source_url: item.source_url })),
}, null, 2))

assert.ok(candidates.length >= 100, `Homologação insuficiente: scanner encontrou apenas ${candidates.length} produtos de um catálogo externo com 1000.`)
assert.ok(withPrice.length >= Math.floor(candidates.length * 0.9), 'Menos de 90% dos produtos coletados possuem preço válido.')
assert.ok(withImage.length >= Math.floor(candidates.length * 0.9), 'Menos de 90% dos produtos coletados possuem imagem.')
console.log('LIVE_SCANNER_MEASURE_OK')
