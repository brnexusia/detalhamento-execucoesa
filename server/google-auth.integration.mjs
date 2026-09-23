import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const hook = read('server/google-auth-hooks.mjs')
const security = read('server/security-hooks.mjs')
const auth = read('src/Auth.tsx')
const googleButton = read('src/GoogleSignInButton.tsx')
const app = read('server/app.mjs')
const pkg = JSON.parse(read('package.json'))

assert.match(hook, /verifyIdToken\(\{ idToken: credential, audience: googleClientId \}\)/)
assert.match(hook, /email_verified !== true/)
assert.match(hook, /google_sub/)
assert.match(hook, /GOOGLE_CLIENT_ID/)
assert.doesNotMatch(hook, /GOOGLE_CLIENT_SECRET/)
assert.match(app, /password_hash text,/)
assert.match(app, /idx_users_google_sub_unique/)
assert.match(security, /https:\/\/accounts\.google\.com\/gsi\/client/)
assert.match(security, /same-origin-allow-popups/)
assert.match(googleButton, /https:\/\/accounts\.google\.com\/gsi\/client/)
assert.match(googleButton, /renderButton/)
assert.match(auth, /GoogleSignInButton/)
assert.match(auth, /Criar minha loja com Google/)
assert.equal(typeof pkg.dependencies?.['google-auth-library'], 'string')
assert.match(pkg.scripts.start, /google-auth-hooks\.mjs/)

console.log('Google authentication regression checks passed.')
