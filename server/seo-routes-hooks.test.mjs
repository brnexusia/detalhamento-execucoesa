import test from 'node:test'
import assert from 'node:assert/strict'
import { xmlEscape, canonicalUrl, isPositivePage, urlset, sitemapIndex } from './seo-routes-hooks.mjs'

test('XML sanitizes dynamic URL values', () => {
  assert.match(xmlEscape('a&<"b'), /a&amp;&lt;&quot;b/)
  assert.match(urlset([{url: canonicalUrl('/loja', '?produto=a&b=1')}]), /&amp;b=1/)
  assert.doesNotMatch(urlset([{url: 'https://shopvax.com.br/'}]), /<script/)
})
test('sitemap index retains canonical hostname', () => {
  assert.match(sitemapIndex([canonicalUrl('/sitemap-pages.xml')]), /shopvax\.com\.br\/sitemap-pages\.xml/)
})
test('rejects invalid page indices', () => {
  for (const value of ['0','-1','1.2','01','1234567','abc']) assert.equal(isPositivePage(value), false)
  assert.equal(isPositivePage('1'), true)
  assert.equal(isPositivePage('500'), true)
})
