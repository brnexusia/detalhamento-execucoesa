import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'

// Gerado antes do Vite pelo script build-ui-version.mjs.
// Injeta a mesma fingerprint no bundle e no endpoint do servidor.
const stampFile = 'public/shopvax-ui-version.json'
let release = { sourceFingerprint: 'development', builtAt: '' }
if (existsSync(stampFile)) {
  try {
    const value = JSON.parse(readFileSync(stampFile, 'utf8'))
    if (typeof value?.sourceFingerprint === 'string' && typeof value?.builtAt === 'string') {
      release = { sourceFingerprint: value.sourceFingerprint, builtAt: value.builtAt }
    }
  } catch { /* desenvolvimento local sem carimbo */ }
}

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SHOPVAX_UI_FINGERPRINT': JSON.stringify(release.sourceFingerprint),
    'import.meta.env.VITE_SHOPVAX_UI_BUILT_AT': JSON.stringify(release.builtAt),
  },
})
