import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const fs = (p) => readFileSync(new URL(p, import.meta.url))
const text = (p) => fs(p).toString('utf8')
function gitSha(buffer) {
  return createHash('sha1').update('blob ' + buffer.length + '\0').update(buffer).digest('hex')
}
const sourceFiles = {
  '../vendor/screenshot-to-spark-0332/src/routes/index.tsx':'ddfa7e7c0e21409c0774e748a69d141a2fe7a517',
  '../vendor/screenshot-to-spark-0332/src/styles.css':'7666ec6e18f773f3949d935570a69471cf7eb2d6',
  '../vendor/screenshot-to-spark-0332/src/components/Intro.tsx':'ff5907676ec0560a72d4a663ede671f15741b7d2',
  '../vendor/screenshot-to-spark-0332/src/lib/links.ts':'d7cf60aa7742eef5a5ff6953faf9ce8438a94969',
  '../vendor/screenshot-to-spark-0332/src/assets/feed-1.jpg':'de58b2b708c412dfe69d2fa3cdafd951fab7c5ce',
  '../vendor/screenshot-to-spark-0332/src/assets/feed-2.jpg':'756db93ed94c648f0b185f7f925531efa3e5c346',
  '../vendor/screenshot-to-spark-0332/src/assets/store.jpg':'f56977148141a10cc95d494c62042de569fb3413',
}
test('componentes e imagens originais preservados byte a byte', () => {
 for (const [path, sha] of Object.entries(sourceFiles)) assert.equal(gitSha(fs(path)), sha, path)
})
test('a LP importa diretamente a página original com seu Tailwind', () => {
 assert.match(text('../landing-integration/entry.tsx'), /import \{ Route \} from "\.\.\/vendor\/screenshot-to-spark-0332\/src\/routes\/index"/)
 assert.match(text('../landing-integration/entry.tsx'), /import "\.\.\/vendor\/screenshot-to-spark-0332\/src\/styles\.css"/)
 assert.match(text('../landing-integration/vite.config.mjs'), /base: "\/para-lojas\/"/)
 assert.match(text('../landing-integration/vite.config.mjs'), /tailwindcss\(\)/)
})
test('a navegação da LP vai aos fluxos reais, fora da própria LP', () => {
 const links = text('../landing-integration/links.ts')
 assert.match(links, /signup: "\/criar-conta"/)
 assert.match(links, /partner: "\/parceiros"/)
 assert.doesNotMatch(links, /shopvax\.com\.br\/para-lojas/)
 const app = text('./app.mjs')
 assert.match(app, /app\.get\(\['\/para-lojas', '\/para-lojas\/'\]/)
 assert.match(app, /'para-lojas', 'index\.html'/)
})
