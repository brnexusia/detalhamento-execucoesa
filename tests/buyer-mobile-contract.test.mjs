import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('CSS global não interfere nas margens do comprador',()=>{
 const css=read('src/styles.css')
 assert.equal(css.match(/main:not\(\.feed-shell\):not\(\.social-feed-list\):not\(\.buyer-screen\)/g)?.length,2)
 const buyer=read('src/buyer-app.css')
 assert.match(buyer,/main\.buyer-screen \{[\s\S]*min-height:100svh/)
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

test('canvas storefront padding cannot override buyer page geometry',()=>{
 const canvas=read('src/canvas.css')
 assert.match(canvas,/\.app > main:not\(\.feed-shell\)/)
 assert.doesNotMatch(canvas,/(?:^|\n)\s*main:not\(\.feed-shell\)\s*\{/)
 const buyer=read('src/buyer-app.css')
 assert.match(buyer,/html:has\(body\.shopvax-buyer-page\)/)
 assert.match(buyer,/padding-bottom:calc\(84px \+ env\(safe-area-inset-bottom\)\)/)
})
test('UI build revision covers buyer and search source',()=>{
 const file=read('scripts/build-ui-version.mjs')
 for(const path of ['src/App.tsx','src/SocialDiscover.tsx','src/buyer-app.css','src/canvas.css','server/buyer-discovery-hooks.mjs']) {
   assert.ok(file.includes("'"+path+"'"),path+' excluded from build identity')
 }
})

test('Docker inicia o endpoint real de pesquisa, sem fallback para HTML',()=>{
 const docker=read('Dockerfile')
 assert.match(docker,/--import", "\.\/server\/buyer-discovery-hooks\.mjs"/)
 const source=read('server/buyer-discovery-hooks.mjs')
 assert.match(source,/app\.get\('\/api\/social\/discover',wrap\(discover\)\)/)
})

test('busca mostra autocomplete de dados retornados e contagens visiveis',()=>{
 const search=read('src/SocialDiscover.tsx')
 const autocomplete=read('src/BuyerSearchAutocomplete.tsx')
 assert.match(search,/import BuyerSearchAutocomplete from/)
 assert.match(search,/ready=\{!loading&&!error&&!needsLogin&&currentKey===loadedKey\}/)
 assert.match(search,/results\.stores\.length/)
 assert.match(search,/results\.products\.length/)
 assert.match(search,/contentType\.toLowerCase\(\)\.includes\('application\/json'\)/)
 assert.match(autocomplete,/stores\.map\(s=>/)
 assert.match(autocomplete,/products\.map\(p=>/)
 assert.match(autocomplete,/onQuery\(suggestion\.label\)/)
 assert.match(autocomplete,/role="combobox"/)
 assert.match(autocomplete,/role="listbox"/)
 assert.match(autocomplete,/aria-selected/)
 assert.match(autocomplete,/event\.key==='ArrowDown'/)
 assert.match(autocomplete,/Sugestões para começar/)
})
