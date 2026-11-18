/**
 * Visually confirmed unit prices from original Google Photos (high-resolution
 * photos wherever available; enlarged audit contact sheets for changed albums)
 * of MAMA Acessórios. The 2026-11-16 audit marked all these as OCR failures.
 *
 * Values are keyed by original source-image identity rather than mutable
 * album position: adding/reordering a photo cannot change product prices.
 *
 * Reproduce: node scripts/mama-reviewed-prices-20261118.mjs
 * Output: /tmp/mama-visual-prices-reviewed.json
 *
 * This source intentionally excludes photographs WITHOUT A LEGIBLE UNIT
 * PRICE. No prices are inferred from identifiers, dozen prices, or adjacent
 * photographs. Creating this JSON does not modify any database.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { links } from './mama-public-album-links.mjs'
import { baselineSourceKeys } from './mama-baseline-source-keys.mjs'

export const confirmedUnitPricesByBaselinePhoto = {
  // 0-based album index, 1-based photo index of 2026-11-16 audit.
  // Catálogo Verão: three kit-boné stickers 1 PÇ R$ 33,00.
  0: {279:33,280:33,281:33},
  // Lenços de Verão: explicit 1 PÇ R$ 28,00 on two photos.
  1: {217:28,218:28},
  // Broches e Chaveiros: readable 1 PÇ R$ 17,00.
  2: {54:17},
  // Brincos: exact prices visible in enlarged printed stickers.
  3: {12:15,13:18,14:18,15:18,16:18,187:12,228:14},
  // Colares - Aros: price R$ 10,00 confirmed by the complete image.
  4: {39:10,119:17,131:17,132:17,134:17,140:17,141:17},
  // Colares e Maxi Colares.
  5: {14:17,15:17,19:17,35:17,38:17},
  // Pulseiras e Braceletes: 139 lacks a visible price.
  7: {9:17,104:17,105:17},
  // Chokers e Colares Delicados: other missing photos lack stickers.
  8: {3:17,9:17,212:17},
  // Anéis: 13 stickers explicitly state 1 PÇ R$ 7,00 (OCR read 700).
  9: {17:7,38:7,45:7,51:7,64:7,65:7,66:7,72:7,80:7,96:7,122:7,124:7,138:7},
  // Acessórios Cabelo Adulto: use price for 1 PC, NOT 'DZ' price.
  13: {16:7,18:7,36:7,187:5,188:10,189:10,190:10,191:10,
       192:9,193:9,194:9,195:9,196:9,197:13,198:10,199:10},
  // Catálogo Inverno: unit price from label; do not use dozen price.
  18: {10:20,27:15,51:38,52:38,64:18,74:70,85:30,
       103:35,104:25,105:35,106:38,107:16,108:16,109:16,112:16,113:16},
  // Catálogo Inverno Infantil.
  19: {27:23},
}

export function confirmedMamaVisualPrices() {
  const output = {}
  for (const [index, photos] of Object.entries(confirmedUnitPricesByBaselinePhoto)) {
    const albumUrl = links[Number(index)]?.[1]
    if (!albumUrl) throw Error('Álbum inválido no mapa de revisão: ' + index)
    for (const [photo, price] of Object.entries(photos)) {
      const imageKey = baselineSourceKeys[index]?.[photo]
      if (!/^[A-Za-z0-9_-]{22}$/.test(String(imageKey || ''))) {
        throw Error('Foto sem identificação original da auditoria: álbum ' + index + ', foto ' + photo)
      }
      if (!Number.isFinite(price) || price <= 0 || price > 100000) {
        throw Error('Preço confirmado inválido no álbum ' + index + ', foto ' + photo)
      }
      const key = albumUrl + '#photo:' + imageKey
      if (Object.hasOwn(output,key)) throw Error('Foto de origem duplicada: ' + key)
      output[key] = price
    }
  }
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.env.MAMA_VISUAL_PRICES_FILE || '/tmp/mama-visual-prices-reviewed.json'
  const data = confirmedMamaVisualPrices()
  await writeFile(dest,JSON.stringify(data,null,2)+'\n')
  console.log('MAMA_VISUAL_VERIFIED '+JSON.stringify({confirmed:Object.keys(data).length,dest}))
}
