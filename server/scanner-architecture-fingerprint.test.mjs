import test from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintStorefront, architectureCoverage } from './scanner-architecture-fingerprint.mjs'
const fixture=[
  ['gopage','https://modelo.gopage.bio/', '<main>Produtos: R$ 29,90</main>'],
  ['facilzap','https://loja.facilzap.app.br/','<script>window.FZCatalogoRuntime={}</script>'],
  ['nuvemshop','https://demo.lojavirtualnuvem.com.br/','<script type="application/ld+json">{"@type":"Product"}</script>'],
  ['shopify','https://shop.example/','<script src="https://cdn.shopify.com/a.js"></script>'],
  ['woocommerce','https://shop.example/','<script src="/wp-content/plugins/woocommerce/a.js"></script>'],
  ['vtex','https://shop.example/','<img src="https://example.vteximg.com.br/arquivo.jpg">'],
  ['magento','https://shop.example/','<script src="/static/version123/Magento_Ui/js/view/messages.js"></script>'],
  ['bigcommerce','https://shop.example/','<script src="https://cdn11.bigcommerce.com/s-aa/app.js"></script>'],
  ['wix','https://shop.example/','<img src="https://static.wixstatic.com/media/p.jpg">'],
  ['squarespace','https://shop.example/','<script src="https://static1.squarespace.com/a.js"></script>'],
  ['prestashop','https://shop.example/','<script>var prestashop={}</script>'],
  ['opencart','https://shop.example/','<a href="/index.php?route=product/product&product_id=1">Produto</a>'],
]
for(const [engine,url,html] of fixture){
  test('fingerprint '+engine,()=>{
    const f=fingerprintStorefront(html,url)
    assert.equal(f.engine,engine)
    assert.ok(f.architectureKey.startsWith(engine+'/'))
  })
}
test('different domains of the same platform count as ONE engine',()=>{
  const a=fingerprintStorefront('<script src="https://cdn.shopify.com/a.js"></script>','https://shop-one.example/')
  const b=fingerprintStorefront('<script src="https://cdn.shopify.com/b.js"></script>','https://shop-two.example/')
  assert.equal(a.architectureKey,b.architectureKey)
  const g=architectureCoverage([a,b])
  assert.equal(g.length,1)
  assert.equal(g[0].count,2)
})
test('headless variants are diagnostic variations, not proof of a new backend',()=>{
  const classic=fingerprintStorefront('<script src="https://cdn.shopify.com/a.js"></script>','https://a.example/')
  const headless=fingerprintStorefront('<script src="https://cdn.shopify.com/a.js"></script><script src="/_next/static/a.js"></script>','https://b.example/')
  assert.equal(classic.engine,headless.engine)
  assert.notEqual(classic.architectureKey,headless.architectureKey)
})
