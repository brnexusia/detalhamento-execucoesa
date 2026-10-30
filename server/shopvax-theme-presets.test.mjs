import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { resolveShopvaxTheme, seasonalThemeIds } from './shopvax-theme-presets.mjs'
import { streamCatalogPdf } from './catalog-pdf.mjs'

async function render(store) {
  const output = new PassThrough()
  output.headers = {}
  output.status = function status(code) { this.statusCode = code; return this }
  output.setHeader = function setHeader(name, value) { this.headers[name.toLowerCase()] = value }
  const chunks = []
  output.on('data', chunk => chunks.push(chunk))
  const ended = new Promise((resolve, reject) => { output.once('end', resolve); output.once('error', reject) })
  await streamCatalogPdf({
    res: output,
    store: { id:'store-test', slug:'loja', name:'Loja Exemplo', logo_url:'', ...store },
    catalog: { name:'Catálogo Real', kind:'atacado', minimum_order:100 },
    products: [
      { id:'1', sku:'REF-1', name:'Produto Verificado', price:29.9, public_price:29.9, category:'Moda', images:[], variations:[], media_type:'image', media_url:'' },
    ],
    imageLoader: async () => null,
  })
  await ended
  return { bytes:Buffer.concat(chunks),headers:output.headers,status:output.statusCode }
}

test('paletas e temas completos possuem textos, fundos e dica sem desconto inventado', () => {
  assert.deepEqual(seasonalThemeIds, ['padrao','black-friday','natal','sao-joao'])
  const defaultTheme = resolveShopvaxTheme({ accent:'#003366', seasonal_theme:'padrao' })
  assert.equal(defaultTheme.accent, '#003366', 'PDF deve usar a paleta da loja no tema padrão')
  const black = resolveShopvaxTheme({ accent:'#003366', seasonal_theme:'black-friday' })
  assert.equal(black.label, 'BLACK FRIDAY')
  assert.notEqual(black.background, defaultTheme.background)
  assert.notEqual(black.accent, defaultTheme.accent)
  assert.match(black.tip, /preços/i)
  for (const id of seasonalThemeIds) {
    const theme = resolveShopvaxTheme({ seasonal_theme:id })
    for (const field of ['name','label','message','tip','background','surface','ink','accent','soft','line']) {
      assert(theme[field], `Tema ${id}: falta ${field}`)
    }
    assert.doesNotMatch(theme.message, /\d+%|frete grátis|somente hoje/i, 'Não anunciar ofertas inexistentes')
  }
  assert.equal(resolveShopvaxTheme({ seasonal_theme:'desconhecido' }).id, 'padrao')
})

test('botão gerar PDF renderiza o tema aplicado, não uma prévia qualquer', async () => {
  const neutral = await render({ accent:'#003366', seasonal_theme:'padrao' })
  const themed = await render({ accent:'#003366', seasonal_theme:'black-friday' })
  const natal = await render({ accent:'#003366', seasonal_theme:'natal' })
  for (const x of [neutral,themed,natal]) {
    assert.equal(x.status, 200)
    assert.equal(x.headers['content-type'], 'application/pdf')
    assert.equal(x.bytes.subarray(0,4).toString('ascii'), '%PDF')
    assert(x.bytes.length > 1200)
  }
  assert.equal(neutral.headers['x-shopvax-theme'], 'padrao')
  assert.equal(themed.headers['x-shopvax-theme'], 'black-friday')
  assert.equal(natal.headers['x-shopvax-theme'], 'natal')

  const extractor = spawnSync('pdftotext', ['-', '-'], { input: themed.bytes })
  if (extractor.status === 0) {
    const text = extractor.stdout.toString('utf8')
    assert.match(text, /BLACK FRIDAY/)
    assert.match(text, /Produto Verificado/)
    assert.match(text, /REF-1/)
    assert.match(text, /29,90/, 'Tema não altera preços reais')
  }
  assert.notDeepEqual(themed.bytes,natal.bytes)
})
