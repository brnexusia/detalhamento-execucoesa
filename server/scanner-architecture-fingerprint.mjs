// Pure fingerprinting for diverse scanner QA. A new domain is NOT a new
// architecture: group by commerce engine, frontend runtime and public feed.
// This is evidence from HTML, not proof of backend implementation.
function value(raw) { return String(raw || '').toLowerCase() }
export function fingerprintStorefront(html, sourceUrl = '') {
  const text=value(html)
  let host=''
  try { host=new URL(sourceUrl).hostname.toLowerCase() } catch {}
  let engine='unknown'
  let evidence=''
  const rules=[
    ['gopage',host.endsWith('.gopage.bio') || host.endsWith('.catalogo.com.br') || /gopage\.bio|gopage\s*(?:cat[aá]logo|digital)/.test(text),'gopage.bio/catalogo.com.br'],
    ['facilzap', host.endsWith('.facilzap.app.br') || /fzcatalogoruntime|assets-cdn\.facilzap\.app\.br/.test(text),'FácilZap runtime'],
    ['zapfacil',host.endsWith('.zapfacil.shop') || host.endsWith('.zapfacil.com.br'),'ZapFácil hostname'],
    ['vesti',host.endsWith('.vesti.co') || host.endsWith('.vesti.mobi') || /cdn-op\.vesti\.mobi/.test(text),'Vesti runtime'],
    ['braavo',/thumb\.braavo\.me|static1\.braavo\.com\.br/.test(text),'Braavo media'],
    ['nuvemshop',host.endsWith('.lojavirtualnuvem.com.br') || host.endsWith('.mitiendanube.com') || /nuvemshop|tiendanube|cdn\.nuvemshop\.com/.test(text),'Nuvemshop signature'],
    ['lojaintegrada',host.endsWith('.lojaintegrada.com.br') || /cdn\.awsli\.com\.br|lojaintegrada/.test(text),'Loja Integrada signature'],
    ['tray',host.endsWith('.commercesuite.com.br') || host.endsWith('.tray.com.br') || /traycdn\.com|tray\.com\.br/.test(text),'Tray signature'],
    ['vtex',/vteximg|vtexassets|vtex\.store|vtex\.io|vtex\.com\.br|catalog_system\/pub|__RUNTIME__/.test(text),'VTEX signature'],
    ['magento',/mage\/cookies|magento_catalog|magento_ui|mage\/requirejs|magento\//.test(text),'Magento signature'],
    ['bigcommerce',/cdn\d+\.bigcommerce\.com|stencil-utils|bigcommerce/.test(text),'BigCommerce signature'],
    ['wix',/wixstatic\.com|parastorage\.com|wix-code-sdk|wix-website/.test(text),'Wix signature'],
    ['squarespace',/static\d*\.squarespace\.com|squarespace\.com\/universal/.test(text),'Squarespace signature'],
    ['prestashop',/prestashop|var prestashop|prestashop\//.test(text),'PrestaShop signature'],
    ['opencart',/index\.php\?route=product|catalog\/view\/theme|opencart/.test(text),'OpenCart signature'],
    ['shopify',/cdn\.shopify\.com|shopify\.theme|shopify-section|myshopify\.com/.test(text),'Shopify signature'],
    ['woocommerce',/woocommerce|wc-block|wp-content\/plugins\/woocommerce/.test(text),'WooCommerce signature'],
  ]
  for(const [kind,match,reason] of rules)if(match){engine=kind;evidence=reason;break}
  const frontend= /__next_data__|\/_next\/static\/|next\.js/.test(text) ? 'nextjs' :
    /__nuxt__|\/_nuxt\/|nuxt/.test(text) ? 'nuxt' :
    /data-reactroot|react-dom|id=['"]__next/.test(text) ? 'react' :
    /<\s*[a-z][^>]*\sng-app=|angular\.js|ng-version/.test(text) ? 'angular' :
    /vue\.runtime|data-v-[0-9a-f]{6,}/.test(text) ? 'vue' : 'server-html'
  const feeds=[]
  if(/application\/ld\+json|schema\.org\/product/.test(text))feeds.push('json-ld')
  if(/\bwp-json\b|\?rest_route=/.test(text))feeds.push('wp-rest')
  if(/products\.json|shopify-products/.test(text))feeds.push('products-json')
  if(/__next_data__/.test(text))feeds.push('next-data')
  if(/\/api\/catalog_system\//.test(text))feeds.push('vtex-catalog')
  if(/fzcatalogoruntime/.test(text))feeds.push('facilzap-runtime')
  if(!feeds.length)feeds.push(/og:type['"]?\s*content=['"]product|product:price:amount/.test(text)?'open-graph':'dom-only')
  return {
    engine,frontend,feeds,architectureKey:`${engine}/${frontend}/${feeds.slice().sort().join('+')}`,
    evidence,verifiedBy:'html-signatures',url:sourceUrl,
  }
}

export function architectureCoverage(rows) {
  const groups=new Map()
  for(const row of rows||[]) {
    if(!row?.architectureKey)continue
    const group=groups.get(row.architectureKey)||{architectureKey:row.architectureKey,count:0,exampleUrls:[]}
    group.count++
    if(group.exampleUrls.length<3&&row.url)group.exampleUrls.push(row.url)
    groups.set(group.architectureKey,group)
  }
  return [...groups.values()].sort((a,b)=>a.architectureKey.localeCompare(b.architectureKey))
}
