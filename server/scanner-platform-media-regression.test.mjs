import test from 'node:test'
import assert from 'node:assert/strict'
import { facilZapProducts, vestiProducts, extractFacilZapDetailProduct } from './scanner-platforms.mjs'

test('FácilZap imports gallery photos even when only variations carry the images', () => {
  const source = 'https://minhaloja.com.br/'
  const { products } = facilZapProducts({
    produtos: [{
      id: 101, nome: 'Vestido', preco: '49,90',
      galeria: [{ image_url: 'produtos/capa.webp' }],
      variacoes: {
        azul: { id: 'azul', nome: 'Azul', fotos: [{ path: 'produtos/azul.webp' }] },
        preto: { id: 'preto', nome: 'Preto', images: [{ imageUrl: 'https://cdn.example.com/preto.webp' }] },
      },
    }],
  }, source)
  assert.equal(products.length, 1)
  assert.deepEqual(products[0].images, [
    'https://arquivos.facilzap.app.br/produtos/capa.webp',
    'https://arquivos.facilzap.app.br/produtos/azul.webp',
    'https://cdn.example.com/preto.webp',
  ])
  assert.deepEqual(products[0].variants.map(v => v.images[0]), [
    'https://arquivos.facilzap.app.br/produtos/azul.webp',
    'https://cdn.example.com/preto.webp',
  ])
})

test('FácilZap generates a store-scoped product page on hosted catalogs without trailing slash',()=>{
  const product={id:'3950372',nome:'Conjunto Aço Inox',preco:'34,90',imagens:['produtos/conjunto.webp']}
  const hosted=facilZapProducts({produtos:[product]},'https://facilzap.app.br/labijuterias')
  assert.equal(hosted.products[0].source_url,'https://facilzap.app.br/labijuterias/produto/3950372')
  const hostedWithSlash=facilZapProducts({produtos:[product]},'https://facilzap.app.br/labijuterias/')
  assert.equal(hostedWithSlash.products[0].source_url,hosted.products[0].source_url)
  const realGalego=facilZapProducts({produtos:[{
    id:'4419956',nome:'Brinco Aço Inox',imagens:['produtos/1787876125_fb3aa3165caa45e86750.webp'],
  }]},'https://facilzap.com.br/galegobijooux')
  assert.equal(realGalego.products[0].source_url,
    'https://facilzap.com.br/galegobijooux/produto/4419956',
    'facilzap.com.br precisa preservar o slug da loja, como facilzap.app.br')
  const withSlash=facilZapProducts({produtos:[{id:'4419956',nome:'Brinco Aço Inox'}]},
    'https://facilzap.com.br/galegobijooux/')
  assert.equal(withSlash.products[0].source_url,realGalego.products[0].source_url)
  const customDomain=facilZapProducts({produtos:[product]},'https://minhaloja.example/')
  assert.equal(customDomain.products[0].source_url,'https://minhaloja.example/produto/3950372')
  const explicit=facilZapProducts({produtos:[{...product,url:'/labijuterias/produto/3950372'}]},'https://facilzap.app.br/labijuterias')
  assert.equal(explicit.products[0].source_url,hosted.products[0].source_url)
})

test('Vesti captures images across image, photos, gallery, and SKU media', () => {
  const context = { catalogBaseUrl: 'https://v.vesti.mobi/loja/catalogo/abc' }
  const [result] = vestiProducts({
    products: [{
      id: '10', name: 'Camisa', code: 'REF10',
      media: [{ path: 'https://cdn.example.com/capa.webp' }],
      gallery: [{ image_url: 'https://cdn.example.com/lado.webp' }],
      stocks: [{
        id: '11', sku: 'CAM-11', color_name: 'Rosa',
        photos: [{ photoUrl: 'https://cdn.example.com/rosa.webp' }],
      }],
    }],
  }, context)
  assert.deepEqual(result.images, [
    'https://cdn.example.com/capa.webp',
    'https://cdn.example.com/lado.webp',
    'https://cdn.example.com/rosa.webp',
  ])
  assert.deepEqual(result.variants[0].images, ['https://cdn.example.com/rosa.webp'])
  assert.equal(result.sku, 'REF10')
})

test('FácilZap associates dictionary variation images by ID and parses color + size',()=>{
  const {products}=facilZapProducts({produtos:[{
    id:'55',nome:'Conjunto',imagens:['produtos/capa.webp'],
    imagens_variacoes:{'100':['produtos/azul.webp'],'101':[{imagem:'produtos/preto.webp'}]},
    variacoes:{
      '100':{id:'100',nome:'Azul Tamanho P',cor:'#0000ff'},
      '101':{id:'101',nome:'Preto Tamanho M',cor:'#000000'},
    },
  }]},'https://lojista.exemplo.com/')
  assert.deepEqual(products[0].variants.map(x=>[x.color,x.size]),[['Azul','P'],['Preto','M']])
  assert.deepEqual(products[0].variants[0].images,['https://arquivos.facilzap.app.br/produtos/azul.webp'])
  assert.deepEqual(products[0].images,[
    'https://arquivos.facilzap.app.br/produtos/capa.webp',
    'https://arquivos.facilzap.app.br/produtos/azul.webp',
    'https://arquivos.facilzap.app.br/produtos/preto.webp',
  ])
})

test('FácilZap parses nested DadosProduto JSON with quotation and gallery',()=>{
  const obj={id:'4612607',nome:'Calcinha Sofia',
    descricao:'Modelo com \\"cintura alta\\" e tecido leve',
    imagens:['produtos/calcinha.webp'],
    variacoes:{'10':{id:'10',nome:'Rosa Tamanho M'}},
  }
  const html='<script>const DadosProduto = '+JSON.stringify(obj)+';\\nwindow.foo=true</script>'
  const product=extractFacilZapDetailProduct(html,'https://damafinnalingerie.com.br/produto/4612607')
  assert.equal(product?.external_id,'4612607')
  assert.equal(product?.description,obj.descricao)
  assert.deepEqual(product?.images,['https://arquivos.facilzap.app.br/produtos/calcinha.webp'])
  assert.equal(product?.variants?.[0]?.size,'M')
})
test('FácilZap rejects malformed embedded product JSON',()=>{
 assert.equal(extractFacilZapDetailProduct('const DadosProduto = {notJson: true};','https://example.com'),null)
})
