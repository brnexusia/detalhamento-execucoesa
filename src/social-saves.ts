export type SocialSavedProduct={
 id:string;name:string;sku:string;category:string;mediaUrl:string;mediaType?:'image'|'video';
 store:{id?:string;slug:string;name:string;logoUrl?:string}
}
const KEY='shopvax-social-saves-v1'
const EVENT='shopvax:saved-change'
let remoteIds=new Set<string>()
let remoteProducts:SocialSavedProduct[]=[]
let sessionBuyerId=''
const local=():SocialSavedProduct[]=>{
 try{
  const json=JSON.parse(localStorage.getItem(KEY)||'[]')
  return Array.isArray(json)?json.filter((v):v is SocialSavedProduct=>Boolean(v?.id&&v.store?.slug)).slice(0,100):[]
 }catch{return []}
}
const write=(items:SocialSavedProduct[])=>{
 try{localStorage.setItem(KEY,JSON.stringify(items.slice(0,100)))}catch{}
 window.dispatchEvent(new Event(EVENT))
}
export const socialSaveEvent=EVENT
export const isSocialSaved=(id:string)=>remoteIds.has(id)||local().some(x=>x.id===id)
export const localSocialSaved=()=>local()
export function resetSocialSaveSession(){remoteIds.clear();remoteProducts=[];sessionBuyerId='';window.dispatchEvent(new Event(EVENT))}
export async function listSocialSaved():Promise<{products:SocialSavedProduct[],stores:SocialFollowedStore[],authenticated:boolean}>{
 try{
  const me=await fetch('/api/public/buyer-auth/me',{credentials:'include',cache:'no-store'})
  if(!me.ok) {resetSocialSaveSession();return {products:local(),stores:[],authenticated:false}}
  const identity=await me.json()
  if(!identity?.buyer?.profileCompleted){resetSocialSaveSession();return {products:local(),stores:[],authenticated:false}}
  const buyerId=String(identity.buyer.id||'')
  if(sessionBuyerId&&sessionBuyerId!==buyerId)resetSocialSaveSession()
  sessionBuyerId=buyerId
  const response=await fetch('/api/social/buyer/saved',{credentials:'include',cache:'no-store'})
  if(!response.ok)throw Error('Não foi possível carregar seus salvos.')
  const data=await response.json() as {products:SocialSavedProduct[],stores:SocialFollowedStore[]}
  const remote=Array.isArray(data.products)?data.products:[]
  const guest=local()
  remoteIds=new Set(remote.map(p=>p.id))
  // Só sincroniza itens que o próprio visitante salvou explicitamente.
  for(const p of guest){
   if(remoteIds.has(p.id))continue
   try{
    const r=await fetch('/api/social/buyer/saved',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:p.id,saved:true})})
    if(r.ok){remoteIds.add(p.id);remote.push(p)}
   }catch{}
  }
  const pending=guest.filter(p=>!remoteIds.has(p.id))
  write(pending)
  remoteProducts=remote
  return {products:[...pending,...remote],stores:Array.isArray(data.stores)?data.stores:[],authenticated:true}
 }catch{
  return {products:[...local(),...remoteProducts.filter(p=>!local().some(x=>x.id===p.id))],stores:[],authenticated:Boolean(sessionBuyerId)}
 }
}
export async function toggleSocialSaved(product:SocialSavedProduct):Promise<boolean>{
 const next=!isSocialSaved(product.id)
 const items=local().filter(p=>p.id!==product.id)
 if(next)items.unshift(product)
 if(next)remoteIds.add(product.id)
 else remoteIds.delete(product.id)
 write(items)
 try{
  const me=await fetch('/api/public/buyer-auth/me',{credentials:'include',cache:'no-store'})
  if(!me.ok)return next
  const data=await me.json()
  if(!data?.buyer?.profileCompleted)return next
  sessionBuyerId=String(data.buyer.id||'')
  const response=await fetch('/api/social/buyer/saved',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:product.id,saved:next})})
  if(!response.ok)throw Error('Não foi possível sincronizar os salvos.')
  // Atualizado na conta; o item temporário do visitante não precisa ficar.
  write(local().filter(p=>p.id!==product.id))
  remoteProducts=next?[product,...remoteProducts.filter(p=>p.id!==product.id)]:remoteProducts.filter(p=>p.id!==product.id)
  return next
 }catch{
  // Retém a intenção local para sincronizar novamente no próximo acesso.
  if(next)write([product,...local().filter(p=>p.id!==product.id)])
  return next
 }
}
export type SocialFollowedStore={id:string;slug:string;name:string;logoUrl?:string;tagline?:string;productCount?:number}
