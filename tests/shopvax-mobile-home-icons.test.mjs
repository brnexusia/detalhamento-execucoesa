import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const htmlDocuments = [readFileSync('index.html', 'utf8'), readFileSync('landing-integration/index.html', 'utf8')]
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))

test('iOS and Android home-screen metadata use the official Shopvax icon', () => {
  for (const html of htmlDocuments) {
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/shopvax-icon-180\.png\?v=shopvax-20261123"\s*\/>/)
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest\?v=shopvax-20261123"/)
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Shopvax"\s*\/>/)
  }
  assert.equal(manifest.name, 'Shopvax')
  assert.equal(manifest.short_name, 'Shopvax')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#161514')
})

test('the icon files are actual PNG images with the declared square dimensions', () => {
  for (const size of [180, 192, 512]) {
    const bytes = readFileSync(`public/shopvax-icon-${size}.png`)
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `PNG signature ${size}`)
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR')
    assert.equal(bytes.readUInt32BE(16), size, `width ${size}`)
    assert.equal(bytes.readUInt32BE(20), size, `height ${size}`)
  }
  for (const size of [192, 512]) {
    assert.ok(manifest.icons.some((icon) =>
      icon.src === `/shopvax-icon-${size}.png?v=shopvax-20261123` &&
      icon.sizes === `${size}x${size}` &&
      icon.type === 'image/png'
    ), `missing Android ${size} icon`)
  }
})
