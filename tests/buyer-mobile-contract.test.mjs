import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('CSS global não interfere nas margens do comprador',()=>{
 const css=read('src/styles.css')
 assert.equal(css.match(/main:not\(\.feed-shell\):not\(\.social-feed-list\):not\(\.buyer-screen\)/g)?.length,2)
 const buyer=read('src/buyer-app.css')
 assert.match(buyer,/main\.buyer-screen \{width:100%;max-width:none;min-height:100dvh/)
 assert.match(buyer,/body\.shopvax-buyer-page #root/)
})
test('ajuda flutuante não aparece no perfil do comprador',()=>{
 const app=read('src/App.tsx')
 const line=app.split('\n').find(x=>x.includes('const helpAllowed'))
 assert.ok(line)
 assert.doesNotMatch(line,/page === 'buyer'/)
})
test('filtros responsivos e botão de tentar novamente',()=>{
 const discover=read('src/SocialDiscover.tsx')
 assert.match(discover,/className="buyer-filter-field buyer-filter-field--mode"/)
 assert.match(discover,/htmlFor="svx-max"/)
 assert.match(discover,/setRetry/)
})
