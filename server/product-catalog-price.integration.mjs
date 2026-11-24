import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'

// Never run this test against production; only disposable local PostgreSQL.
const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
if (process.env.NODE_ENV !== 'test' || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(base) ||
    !/shopvax_test/.test(process.env.DATABASE_URL || '')) {
  throw Error('Teste de preço por catálogo permitido somente em banco local descartável shopvax_test.')
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const suffix = crypto.randomBytes(6).toString('hex')
const id = () => crypto.randomUUID()
const users = []
const request = async (cookie, path, method = 'GET', body) => {
  const response = await fetch(base + path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}
const auth = (token) => 'atacado_session=' + token
const makeStore = async (plan, name) => {
  const userId = id(), storeId = id(), token = crypto.randomBytes(32).toString('base64url')
  await pool.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',
    [userId, name, 'catalog-price-' + suffix + '-' + name + '@example.test', 'disabled'])
  users.push(userId)
  await pool.query(`INSERT INTO stores(id,owner_id,slug,name,plan_tier,billing_required)
    VALUES($1,$2,$3,$4,$5,false)`, [storeId,userId,'test-'+suffix+'-'+name,name,plan])
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'1 day\')',
    [crypto.createHash('sha256').update(token).digest('hex'),userId])
  return { storeId, cookie: auth(token) }
}

const updatePayload = (price, extra = {}) => ({
  name: 'Pantalona Celeste LUX Fluity', sku: 'SW-4076-' + suffix,
  description: 'Produto importado da SW', price, category: 'Geral',
  mediaUrl: '', mediaType: 'image', pack: 'Grade P-M-G', variations: [],
  featured: false, active: true, ...extra,
})

try {
  const owner = await makeStore('ouro','owner')
  const stranger = await makeStore('bronze','other')
  const catalogs = await request(owner.cookie,'/api/admin/catalogs')
  assert.equal(catalogs.status,200,JSON.stringify(catalogs.json))
  const general = catalogs.json.catalogs.find(c => c.isDefault)
  assert.ok(general)
  const other = await request(owner.cookie,'/api/admin/catalogs','POST',{
    name:'Atacado separado',kind:'atacado',minimumOrder:0,
  })
  assert.equal(other.status,201,JSON.stringify(other.json))
  const distinctCatalogId = other.json.catalog.id
  const productId = id()
  await pool.query(`INSERT INTO products(id,store_id,sku,name,description,price,category,retail_price)
    VALUES($1,$2,$3,$4,$5,89.90,'Geral',NULL)`,
    [productId,owner.storeId,'SW-4076-'+suffix,'Pantalona Celeste LUX Fluity','Importado'])
  // Reproduce the actual importer: it writes catalog_products.price_override,
  // which takes precedence over products.price when listing the catalog.
  await pool.query(`INSERT INTO catalog_products(catalog_id,product_id,price_override,visible)
    VALUES($1,$2,129.90,true),($3,$2,149.90,true)`,
    [general.id,productId,distinctCatalogId])

  const getPrice = async (cookie,catalogId) => {
    const r = await request(cookie,'/api/admin/products?catalogId='+encodeURIComponent(catalogId))
    assert.equal(r.status,200,JSON.stringify(r.json))
    return r.json.products.find(x=>x.id===productId)
  }
  let generalProduct = await getPrice(owner.cookie,general.id)
  assert.equal(generalProduct.price,89.9)
  assert.equal(generalProduct.catalogPrice,129.9, 'Reproduz exatamente lista 129,90 versus edição 89,90')
  assert.equal((await getPrice(owner.cookie,distinctCatalogId)).catalogPrice,149.9)

  // Changing the base price must never overwrite an explicit price of a
  // separate catalog. This was the source of the confusing old behavior.
  let response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',updatePayload(99.9))
  assert.equal(response.status,200,JSON.stringify(response.json))
  generalProduct = await getPrice(owner.cookie,general.id)
  assert.equal(generalProduct.price,99.9)
  assert.equal(generalProduct.catalogPrice,129.9)

  // Editing the displayed price in the selected catalog must persist through
  // the existing UI/API rather than merely changing the underlying base.
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(99.9,{catalogId:general.id,catalogPrice:109.9}))
  assert.equal(response.status,200,JSON.stringify(response.json))
  assert.equal(response.json.product.catalogPrice,109.9)
  generalProduct = await getPrice(owner.cookie,general.id)
  assert.equal(generalProduct.catalogPrice,109.9,'Preço deve persistir após recarregar a lista')
  assert.equal(generalProduct.price,99.9,'Preço base mantido')
  assert.equal((await getPrice(owner.cookie,distinctCatalogId)).catalogPrice,149.9,
    'Outro catálogo preserva o preço independente')
  const dbPrice = await pool.query('SELECT price_override FROM catalog_products WHERE catalog_id=$1 AND product_id=$2',
    [general.id,productId])
  assert.equal(Number(dbPrice.rows[0].price_override),109.9,'Preço específico gravado no PostgreSQL')

  const foreignCatalog = await request(stranger.cookie,'/api/admin/catalogs')
  assert.equal(foreignCatalog.status,200,JSON.stringify(foreignCatalog.json))
  const foreignId = foreignCatalog.json.catalogs.find(c=>c.isDefault).id
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(45,{catalogId:foreignId,catalogPrice:12.9}))
  assert.equal(response.status,404,'Catálogo de outra loja não pode ser usado')
  assert.equal((await getPrice(owner.cookie,general.id)).price,99.9,
    'Atualização inválida é revertida de forma atômica')

  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(99.9,{catalogId:general.id,catalogPrice:-10}))
  assert.equal(response.status,400,'Preço negativo não é permitido')
  assert.equal((await getPrice(owner.cookie,general.id)).catalogPrice,109.9)
  // Variant prices survive edits and remain compatible with legacy clients.
  const variations = [{name:'Tamanho',options:['P','M','G']}]
  const variantPrices = {group:'Tamanho',prices:{P:50,M:75}}
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(100,{variations,variantPrices,catalogId:general.id,catalogPrice:100}))
  assert.equal(response.status,200,JSON.stringify(response.json))
  assert.deepEqual((await getPrice(owner.cookie,general.id)).variant_prices,variantPrices)
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(100,{variations}))
  assert.equal(response.status,200,JSON.stringify(response.json))
  assert.deepEqual((await getPrice(owner.cookie,general.id)).variant_prices,variantPrices)
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(100,{variations,variantPrices:{group:'Tamanho',prices:{P:-1}}}))
  assert.equal(response.status,400)
  assert.deepEqual((await getPrice(owner.cookie,general.id)).variant_prices,variantPrices)
  response = await request(owner.cookie,'/api/admin/products/'+productId,'PUT',
    updatePayload(100,{variations,variantPrices:null}))
  assert.equal(response.status,200,JSON.stringify(response.json))
  assert.equal((await getPrice(owner.cookie,general.id)).variant_prices,null)
  // Reproduce actual historical importer provenance (same transaction timestamp
  // for the copied price and completed job), not a manual catalog price.
  const importedId=id()
  await pool.query(`INSERT INTO products(id,store_id,sku,name,description,price,category,retail_price,box_price)
    VALUES($1,$2,$3,'Importado sincronizável','',20,'Geral',35,180)`,
    [importedId,owner.storeId,'SYNC-'+suffix])
  const makeCatalog=async(name,kind,priceMode)=>{
    const r=await request(owner.cookie,'/api/admin/catalogs','POST',{name,kind,priceMode,minimumOrder:0,...(kind==='personalizado'?{customLabel:'Especial'}:{})})
    assert.equal(r.status,201,JSON.stringify(r.json))
    return r.json.catalog.id
  }
  const retailId=await makeCatalog('Varejo sincronizável','varejo','base')
  const boxId=await makeCatalog('Caixa sincronizável','caixa_fechada','base')
  const wholesaleId=await makeCatalog('Atacado sincronizável','atacado','base')
  const customRetail=await makeCatalog('Personalizado varejo','personalizado','varejo')
  const fixtures=[[general.id,25],[wholesaleId,26],[retailId,40],[boxId,200],[customRetail,45]]
  for(const [catalogId,oldPrice] of fixtures){
    const jobId=id()
    const timestamp=new Date('2026-10-15T12:00:00Z')
    await pool.query(`INSERT INTO import_jobs(id,store_id,source_url,source_host,status,target_catalog_id,published_at,updated_at)
      VALUES($1,$2,'https://example.test','example.test','completed',$3,$4,$4)`,[jobId,owner.storeId,catalogId,timestamp])
    await pool.query(`INSERT INTO import_normalized_products(id,job_id,store_id,fingerprint,normalized_data,selected,published_product_id,publish_result,published_at)
      VALUES($1,$2,$3,$4,$5,true,$6,'created',$7)`,[id(),jobId,owner.storeId,id(),JSON.stringify({price:oldPrice}),importedId,timestamp])
    await pool.query(`INSERT INTO catalog_products(catalog_id,product_id,price_override,visible,updated_at)
      VALUES($1,$2,$3,true,$4)`,[catalogId,importedId,oldPrice,timestamp])
  }
  // A manually negotiated price in another catalog stays independent.
  await pool.query('INSERT INTO catalog_products(catalog_id,product_id,price_override,visible) VALUES($1,$2,77,true)',[distinctCatalogId,importedId])
  const priceIn=async catalogId=>{
    const r=await request(owner.cookie,'/api/admin/products?catalogId='+encodeURIComponent(catalogId))
    assert.equal(r.status,200,JSON.stringify(r.json))
    return r.json.products.find(p=>p.id===importedId)?.catalogPrice
  }
  const importedUpdate=async(price,extra={})=>{
    const r=await request(owner.cookie,'/api/admin/products/'+importedId,'PUT',updatePayload(price,{sku:'SYNC-'+suffix,name:'Importado sincronizável',...extra}))
    assert.equal(r.status,200,JSON.stringify(r.json))
  }
  await importedUpdate(20,{retailPrice:52})
  assert.equal(await priceIn(retailId),52)
  assert.equal(await priceIn(customRetail),52)
  assert.equal(await priceIn(boxId),200,'Editar varejo não muda caixa')
  assert.equal(await priceIn(wholesaleId),26,'Editar varejo não muda atacado')
  await importedUpdate(23,{boxPrice:240})
  assert.equal(await priceIn(general.id),23)
  assert.equal(await priceIn(wholesaleId),23)
  assert.equal(await priceIn(boxId),240)
  assert.equal(await priceIn(retailId),52)
  assert.equal(await priceIn(distinctCatalogId),77,'Preço manual independente preservado')
  const packaging=[{name:'Embalagem',options:['Unidade','Pacote']}]
  await importedUpdate(23,{variations:packaging,variantPrices:{group:'Embalagem',prices:{Unidade:23,Pacote:115}}})
  const saved=await pool.query('SELECT variant_prices FROM products WHERE id=$1',[importedId])
  assert.equal(saved.rows[0].variant_prices.prices.Pacote,115)
  assert.equal(await priceIn(general.id),23)
  assert.equal(await priceIn(retailId),52)
  assert.equal(await priceIn(distinctCatalogId),77)
  console.log('SHOPVAX_IMPORTED_PRICE_MODES_SYNC_PASS')
  console.log('SHOPVAX_IMPORTED_CATALOG_PRICE_SAVE_AND_TENANT_ISOLATION_PASS')
} finally {
  for (const userId of users.reverse()) {
    await pool.query('DELETE FROM users WHERE id=$1',[userId]).catch(()=>{})
  }
  await pool.end()
}
