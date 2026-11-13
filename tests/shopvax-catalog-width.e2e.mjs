import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const css = readFileSync('src/catalog-manager.css', 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  for (const scenario of [
    { viewport: 390, panel: 366, columns: 1, name: 'mobile' },
    { viewport: 768, panel: 680, columns: 2, name: 'tablet' },
    { viewport: 1024, panel: 760, columns: 2, name: 'compact-desktop' },
    { viewport: 1440, panel: 1090, columns: 2, name: 'wide-desktop' },
    { viewport: 1440, panel: 590, columns: 2, name: 'narrow-panel-large-viewport' },
    { viewport: 320, panel: 296, columns: 1, name: 'small-mobile' },
  ]) {
    const page = await browser.newPage({ viewport: { width: scenario.viewport, height: 900 } })
    try {
      await page.setContent(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>*,*::before,*::after{box-sizing:border-box}body{margin:0}section.panel-shell{width:100%}.svx-products{margin:12px}.test-panel{width:${scenario.panel}px;max-width:calc(100vw - 24px)}
      ${css}</style>
      <section class="panel-shell"><main class="svx-products">
      <div class="test-panel"><div class="svx-catalog-inline" aria-label="Catálogos da loja">
        <header class="svx-catalog-inline__header"><div><h2>Minhas pastas</h2><p>Selecione o catálogo</p></div></header>
        <div class="svx-catalog-folders">
          ${['Varejo', 'Atacado'].map((name,i)=>`<button class="svx-catalog-folder ${i===0?'is-selected':''}" aria-label="${name}" aria-pressed="${i===0}">
            <span class="svx-catalog-folder__icon"></span><span class="svx-catalog-folder__text"><strong>${name}</strong><small>Pedido mínimo R$ 1.000,00</small></span>
            <span class="svx-catalog-folder__state">Publicado</span>
            <span class="svx-catalog-folder__action">Abrir pasta</span></button>`).join('')}
        </div>
        <section class="svx-catalog-folder-details">
          <header class="svx-catalog-folder-details__header"><span class="svx-catalog-folder-details__icon"></span><div><h3>Varejo</h3><p>Pedido mínimo R$ 1.000,00</p></div></header>
          <div class="svx-catalog-card__link"><label>Link público desta pasta</label><input readonly value="https://shopvax-shopvax.7pj7kr.easypanel.host/galego-bijux?catalog=varejo">
            <div class="svx-catalog-card__actions"><button>Copiar link</button><button>Compartilhar</button><a href="#">Abrir catálogo</a></div>
          </div>
          <p class="svx-catalog-folder-details__hint">Produtos da pasta Varejo</p>
        </section>
      </div></div></main></section>`)
      const metrics = await page.evaluate(() => {
        const container = document.querySelector('.svx-catalog-inline')
        const folders = [...document.querySelectorAll('.svx-catalog-folder')]
        const outer = container.getBoundingClientRect()
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          container: { x: outer.x, right: outer.right, width: outer.width },
          folders: folders.map(el => {
            const rect = el.getBoundingClientRect()
            return { x: rect.x, y: rect.y, right: rect.right, width: rect.width }
          }),
          details: (() => { const r=document.querySelector('.svx-catalog-folder-details').getBoundingClientRect();return {left:r.left,right:r.right} })(),
          actions: [...document.querySelectorAll('.svx-catalog-card__actions>*')].map(el => {
            const r=el.getBoundingClientRect()
            return { left:r.left, right:r.right }
          }),
        }
      })
      assert(metrics.documentWidth <= scenario.viewport + 1,
        `${scenario.name}: overflow horizontal da página: ${JSON.stringify(metrics)}`)
      assert(metrics.folders.every(item => item.x >= metrics.container.x - 1 &&
        item.right <= metrics.container.right + 1),
        `${scenario.name}: pasta cortada: ${JSON.stringify(metrics)}`)
      assert(metrics.details.left >= metrics.container.x - 1 &&
        metrics.details.right <= metrics.container.right + 1,
        `${scenario.name}: detalhes da pasta cortados: ${JSON.stringify(metrics)}`)
      assert(metrics.actions.every(item => item.left >= metrics.container.x - 1 &&
        item.right <= metrics.container.right + 1),
        `${scenario.name}: ações fora do painel: ${JSON.stringify(metrics)}`)
      const visualColumns = Math.abs(metrics.folders[0].y - metrics.folders[1].y) < 3 ? 2 : 1
      assert.equal(visualColumns, scenario.columns,
        `${scenario.name}: colunas incompatíveis: ${JSON.stringify(metrics)}`)
      console.log('CATALOG_FOLDER_WIDTH_PASS ' + JSON.stringify({ scenario: scenario.name, ...metrics }))
    } finally { await page.close() }
  }
} finally { await browser.close() }
