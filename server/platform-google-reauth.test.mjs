import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const server = read('server/platform-hooks.mjs')
assert.match(server, /OAuth2Client/)
assert.match(server, /google_sub/)
assert.match(server, /googleCredential/)
assert.match(server, /verifyIdToken/)
assert.match(server, /payload\?\.email_verified !== true/)
assert.match(server, /sub !== String\(user\.google_sub\)/)
assert.match(server, /hasPassword: Boolean\(req\.platformUser\.password_hash\)/)
assert.match(server, /hasGoogle: Boolean\(req\.platformUser\.google_sub\)/)

const ui = read('src/PlatformAdmin.tsx')
assert.match(ui, /GoogleSignInButton/)
assert.match(ui, /googleCredential/)
assert.match(ui, /Confirme novamente sua conta Google/)
assert.match(ui, /hasPassword: boolean; hasGoogle: boolean/)
assert.match(ui, /disabled=\{busy \|\| confirm !== 'EXCLUIR'\}/)

console.log('[platform google reauth] sensitive admin actions support Google confirmation: ok')
