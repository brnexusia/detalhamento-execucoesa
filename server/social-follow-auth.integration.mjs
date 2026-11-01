// Executado contra uma instância isolada do ShopVax com PostgreSQL de teste.
// Nunca usa uma conta real nem tenta alterar dados de produção.
import assert from 'node:assert/strict'

const base = process.env.BASE_URL || 'http://127.0.0.1:3000'
const uid = Math.random().toString(36).slice(2) + '-' + Date.now()
async function call(path,{method='GET',body,cookie}={}) {
  const response = await fetch(base+path,{
    method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
    body:body?JSON.stringify(body):undefined,
  })
  const json = await response.json().catch(()=>({}))
  return {status:response.status,json,cookie:response.headers.get('set-cookie')?.split(';')[0]||''}
}
async function createOwner(label) {
  const result=await call('/api/auth/register',{method:'POST',body:{
    name:'Teste '+label,email:`social-${label}-${uid}@example.com`,
    password:'senha-test-social-123',storeName:`Social ${label} ${uid}`,
    whatsapp:'5571999999999',planCode:'bronze',
  }})
  assert.equal(result.status,201,'Cadastro proprietário: '+JSON.stringify(result))
  assert(result.cookie.startsWith('atacado_session='),'Cookie de lojista ausente')
  const slug=result.json.storeSlug
  const profile=await call('/api/social/stores/'+encodeURIComponent(slug))
  assert.equal(profile.status,200,'Perfil social indisponível '+JSON.stringify(profile))
  return {id:profile.json.store.id,slug,cookie:result.cookie}
}

const a=await createOwner('a')
const b=await createOwner('b')
const endpoint='/api/social/stores/'+encodeURIComponent(a.id)+'/follow'
const anon=await call(endpoint,{method:'POST'})
assert.equal(anon.status,401,'Visitante anônimo não pode seguir')
assert.equal(anon.json.code,'AUTH_REQUIRED')
assert.equal((await call('/api/social/stores/'+a.slug)).json.stats.followers,0,'Visita anônima não deve criar follow')

const ownerFollow=await call(endpoint,{method:'POST',cookie:a.cookie})
assert.equal(ownerFollow.status,200,'Vendedor autenticado não conseguiu seguir')
assert.equal(ownerFollow.json.following,true)
assert.equal(ownerFollow.json.followers,1)
assert.equal((await call('/api/social/stores/'+a.slug,{cookie:a.cookie})).json.stats.following,true)
assert.equal((await call('/api/social/stores/'+a.slug)).json.stats.following,false)
const ownerUnfollow=await call(endpoint,{method:'POST',cookie:a.cookie})
assert.equal(ownerUnfollow.status,200)
assert.equal(ownerUnfollow.json.following,false)

const customer=await call('/api/public/store/'+a.slug+'/customers/register',{method:'POST',body:{
  name:'Comprador Teste',email:`buyer-${uid}@example.com`,
  phone:'5571999999999',password:'senha-buyer-123',
}})
assert.equal(customer.status,201,'Cadastro de comprador legado: '+JSON.stringify(customer))
assert(customer.cookie.startsWith('shopvax_customer_session='),'Cookie de comprador ausente')
const buyerFollow=await call(endpoint,{method:'POST',cookie:customer.cookie})
assert.equal(buyerFollow.status,200,'Comprador autenticado não conseguiu seguir')
assert.equal(buyerFollow.json.following,true)
assert.equal((await call('/api/social/stores/'+a.slug,{cookie:customer.cookie})).json.stats.following,true)
const wrongStore=await call('/api/social/stores/'+b.id+'/follow',{method:'POST',cookie:customer.cookie})
assert.equal(wrongStore.status,403,'Comprador legado não deve atuar em outra loja')
const stolenOrExpired=await call(endpoint,{method:'POST',cookie:'atacado_session=token-invalido'})
assert.equal(stolenOrExpired.status,401,'Sessão inexistente não deve seguir')

console.log('SHOPVAX_FOLLOW_AUTH_PASS: anonimo 401, vendedor, comprador, isolamento da loja, sessao invalida')
