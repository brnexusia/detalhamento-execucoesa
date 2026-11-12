import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const css = readFileSync('src/catalog-manager.css', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  for (const scenario of [
    { viewport: 390, panel: 366, columns: 1, name: 'mobile' },
    { viewport: 768, panel: 680, columns: 1, name: 'tablet' },
    { viewport: 1024, panel: 760, columns: 1, name: 'compact-desktop' },
    { viewport: 1440, panel: 1090, columns: 2, name: 'wide-desktop' },
    { viewport: 1440, panel: 590, columns: 1, name: 'narrow-panel-large-viewport' },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.viewport, height: 900 } })
    try {
      await page.setContent(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>*,*::before,*::after{box-sizing:border-box}body{margin:0}section.panel-shell{width:100%}.svx-products{margin:12px}.test-panel{width:${scenario.panel}px;max-width:calc(100vw - 24px)}
      ${css}</style>
      <section class="panel-shell"><main class="svx-products">
      <div class="test-panel"><div class="svx-catalog-inline" aria-label="Catálogos da loja">
        <header class="svx-catalog-inline__header"><div><h2>Meus catálogos</h2><p>Selecione o catálogo</p></div></header>
        <div class="svx-catalog-inline__cards">
          ${['Varejo', 'Atacado'].map(name=>`<article class="svx-catalog-card">
            <div class="svx-catalog-card__top"><button class="svx-catalog-card__name">${name}</button><span class="svx-catalog-card__status">Publicado</span></div>
            <p class="svx-catalog-card__description">Pedido mínimo R$ 1.000,00</p>
            <div class="svx-catalog-card__link"><label>Link deste catálogo</label><input readonly value="https://shopvax-shopvax.7pj7kr.easypanel.host/galego-bijux?catalog=atacado">
              <div class="svx-catalog-card__actions"><button>Copiar link</button><button>Compartilhar</button><a href="#">Abrir catálogo</a></div>
            </div></article>`).join('')}
        </div></div></div></main></section>`)
      const metrics = await page.evaluate(() => {
        const container = document.querySelector('.svx-catalog-inline')
        const cards = [...document.querySelectorAll('.svx-catalog-card')]
        const outer = container.getBoundingClientRect()
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          container: { x: outer.x, right: outer.right, width: outer.width },
          cards: cards.map(el => {
            const rect=el.getBoundingClientRect()
            return { x:rect.x, y:rect.y, right:rect.right, width:rect.width }
          }),
          actions: [...document.querySelectorAll('.svx-catalog-card__actions>*')].map(el => {
            const r=el.getBoundingClientRect()
            return { left:r.left, right:r.right }
          }),
        }
      })
      assert(metrics.documentWidth <= scenario.viewport + 1,
        `${scenario.name}: overflow horizontal da página: ${JSON.stringify(metrics)}`)
      assert(metrics.cards.every(item => item.x >= metrics.container.x - 1 &&
        item.right <= metrics.container.right + 1),
        `${scenario.name}: cartão cortado: ${JSON.stringify(metrics)}`)
      assert(metrics.actions.every(item => item.left >= metrics.container.x - 1 &&
        item.right <= metrics.container.right + 1),
        `${scenario.name}: ações fora do painel: ${JSON.stringify(metrics)}`)
      const visualColumns = Math.abs(metrics.cards[0].y - metrics.cards[1].y) < 3 ? 2 : 1
      assert.equal(visualColumns, scenario.columns,
        `${scenario.name}: colunas incompatíveis: ${JSON.stringify(metrics)}`)
      console.log('CATALOG_WIDTH_PASS ' + JSON.stringify({ scenario: scenario.name, ...metrics }))
    } finally { await page.close() }
  }
} finally { await browser.close() }
