import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/* Impressão digital do conteúdo realmente empacotado.
   Não depende de .git, variáveis do EasyPanel nem SHA informado manualmente. */
export const uiRevision = 'shopvax-buyer-layout-search-20261109-v4'
export const sourceFiles = [
  'src/App.tsx',
  'src/SocialDiscover.tsx',
  'src/SocialSaved.tsx',
  'src/SocialCarts.tsx',
  'src/GlobalBuyerAccount.tsx',
  'src/buyer-app.css',
  'src/canvas.css',
  'src/styles.css',
  'server/buyer-discovery-hooks.mjs',
  'server/buyer-discovery-search.mjs',
  'src/SocialFeed.tsx',
  'src/shopvax-social-feed-layout.css',
  'src/PublicStoreV2.tsx',
  'src/shopvax-store-layout-fixes.css',
  'src/StoreSocialNav.tsx',
  'src/StoreCommercialInfo.tsx',
  'src/Auth.tsx',
  'src/CustomerAccountRoute.tsx',
  'src/BuyerWhatsappLogin.tsx',
  'src/customer-account.css',
  'src/SocialStoreProfile.tsx',
  'src/SocialProfileHeader.tsx',
  'src/SocialAccountChoice.tsx',
  'src/social-account-choice.css',
  'src/social-profile.css',
  'src/shopvax-social-official.css',
  'src/StoreSocialNav.tsx',
]
const hash = createHash('sha256')
for (const file of sourceFiles) {
  hash.update(file + '\0')
  hash.update(readFileSync(file))
  hash.update('\0')
}
const stamp = {
  revision: uiRevision,
  sourceFingerprint: hash.digest('hex').slice(0, 20),
  builtAt: new Date().toISOString(),
}
const filename = 'public/shopvax-ui-version.json'
mkdirSync(dirname(filename), { recursive: true })
writeFileSync(filename, JSON.stringify(stamp, null, 2) + '\n')
console.log('SHOPVAX_UI_BUILD_STAMP', JSON.stringify(stamp))
