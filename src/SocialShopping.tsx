import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import BuyerWhatsappLogin from './BuyerWhatsappLogin'
import './customer-account.css'
import './social-shopping.css'

type Variant = { name: string; options: string[] }
type Offer = { id: string; slug: string; name: string; kind: 'varejo' | 'atacado' | 'geral'; price: number; minimumOrder: number; unitsPerBox: number }
type Product = { id: string; sku: string; name: string; description: string; category: string; variations: Variant[]; images: string[] }
type OfferPayload = { product: Product; offers: Offer[]; buyerPurpose: string }
type Buyer = { id: string; name: string; phone: string; city: string; profileCompleted: boolean }
type CartLine = { key: string; productId: string; name: string; sku: string; quantity: number; price: number; selections: Record<string,string>; image: string; unitsPerBox: number }
type Cart = { catalog: Offer; items: CartLine[] }
type Props = { storeSlug: string; storeName?: string; productId?: string; initialCart?: boolean; onClose: () => void; onCartChanged?: () => void }
const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })
const prefix = (slug:string) => `shopvax-social-cart-v1:${encodeURIComponent(slug)}:`
const keyFor = (slug:string, catalog:string) => prefix(slug)+encodeURIComponent(catalog)
const readyKey = (slug:string,catalog:string) => 'shopvax-social-ready-v1:'+encodeURIComponent(slug)+':'+encodeURIComponent(catalog)
const readCart = (slug:string,catalog:string): Cart | null => {
  try { const raw=localStorage.getItem(keyFor(slug,catalog)); if(!raw)return null; const data=JSON.parse(raw) as Cart
    return Array.isArray(data.items)&&data.catalog?.slug===catalog?data:null } catch { return null }
}
function allCarts(slug:string):Cart[] {
  const list:Cart[]=[]
  try { for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)||'';if(!key.startsWith(prefix(slug)))continue
    const cart=readCart(slug,decodeURIComponent(key.slice(prefix(slug).length)));if(cart&&cart.items.length)list.push(cart)
  }}catch{ /* storage is optional */ }
  return list
}
export function socialCartCount(slug:string):number { return allCarts(slug).reduce((n,c)=>n+c.items.reduce((t,i)=>t+i.quantity,0),0) }
function persistCart(slug:string, cart:Cart):void {
  try { const key=keyFor(slug,cart.catalog.slug)
    if(cart.items.length)localStorage.setItem(key,JSON.stringify(cart));else localStorage.removeItem(key)
    sessionStorage.removeItem(readyKey(slug,cart.catalog.slug))
    window.dispatchEvent(new CustomEvent('shopvax:social-cart-change',{detail:{storeSlug:slug}}))
  }catch{ /* no persistent storage */ }
}
const parseJson = async (r:Response):Promise<any> => r.json().catch(()=>({}))
const lineKey = (id:string,options:Record<string,string>) => id+':'+Object.entries(options).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('|')
const preferred = (offers:Offer[],purpose:string) => offers.find(x=>purpose==='pessoal'?x.kind==='varejo':purpose==='ambos'?x.kind==='varejo':x.kind==='atacado')||offers[0]

export default function SocialShopping({storeSlug,storeName,productId,initialCart=false,onClose,onCartChanged}:Props){
  const [step,setStep]=useState<'loading'|'auth'|'item'|'cart'|'review'|'ready'|'error'>('loading')
  const [offerData,setOfferData]=useState<OfferPayload|null>(null)
  const [offer,setOffer]=useState<Offer|null>(null)
  const [buyer,setBuyer]=useState<Buyer|null>(null)
  const [seller,setSeller]=useState<{slug:string;name:string}|null>(null)
  const [catalogSlug,setCatalogSlug]=useState('')
  const [cartRevision,setCartRevision]=useState(0)
  const [selections,setSelections]=useState<Record<string,string>>({})
  const [quantity,setQuantity]=useState(1)
  const [notes,setNotes]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [ready,setReady]=useState<{code:string;url:string}|null>(null)
  const storedCarts=useMemo(()=>allCarts(storeSlug),[storeSlug,cartRevision])
  const activeCart=useMemo(()=>storedCarts.find(x=>x.catalog.slug===catalogSlug)||null,[storedCarts,catalogSlug])
  const total=(activeCart?.items||[]).reduce((sum,line)=>sum+line.price*line.quantity,0)
  const minimum=activeCart?.catalog.minimumOrder||0
  const catalogOptions=storedCarts.map(x=>x.catalog)
  useEffect(()=>{
    if(step==='cart' && storedCarts.length && !storedCarts.some(c=>c.catalog.slug===catalogSlug))setCatalogSlug(storedCarts[0].catalog.slug)
  },[storedCarts,catalogSlug,step])
  const reloadCart=useCallback(()=>{setCartRevision(n=>n+1);onCartChanged?.()},[onCartChanged])

  const load=useCallback(async():Promise<boolean>=>{
    setStep('loading');setError('')
    try{
      const session=await fetch('/api/public/buyer-auth/me',{credentials:'include',cache:'no-store'})
      if(!session.ok){if(session.status===401||session.status===403){setStep('auth');return false};throw Error('Não foi possível verificar sua conta.')}
      const body=await parseJson(session)
      if(!body?.buyer?.profileCompleted){setStep('auth');return false}
      setBuyer(body.buyer)
      fetch('/api/social/stores/'+encodeURIComponent(storeSlug)+'/seller-route',{credentials:'include'})
        .then(async r=>r.ok?parseJson(r):null)
        .then(result=>{if(result?.seller)setSeller(result.seller)})
        .catch(()=>undefined)
      if(productId){
        const response=await fetch(`/api/social/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productId)}/offers`,{credentials:'include',cache:'no-store'})
        if(response.status===401){setStep('auth');return false}
        const data=await parseJson(response)
        if(!response.ok)throw Error(data.error||'Produto indisponível.')
        if(!Array.isArray(data.offers)||!data.offers.length)throw Error('Não há modalidade disponível para este produto.')
        const first=preferred(data.offers,data.buyerPurpose)
        setOfferData(data);setOffer(first);setCatalogSlug(first.slug)
        setSelections(Object.fromEntries((data.product.variations||[]).filter((v:Variant)=>v.options.length===1).map((v:Variant)=>[v.name,v.options[0]])))
        setStep(initialCart?'cart':'item')
      }else{
        const carts=allCarts(storeSlug)
        if(carts.length)setCatalogSlug(carts[0].catalog.slug)
        setStep('cart')
      }
      return true
    }catch(e){setError(e instanceof Error?e.message:'Falha ao abrir o pedido.');setStep('error');return false}
  },[storeSlug,productId,initialCart])

  useEffect(()=>{void load()},[load])
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose()};document.addEventListener('keydown',onKey)
    const previous=document.body.style.overflow;document.body.style.overflow='hidden'
    return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=previous}
  },[onClose,busy])

  const selectOffer=(next:Offer)=>{setOffer(next);setCatalogSlug(next.slug);setError('')}
  const addItem=()=>{
    if(!offerData||!offer)return
    for(const v of offerData.product.variations||[])if(!selections[v.name]){setError('Escolha '+v.name.toLowerCase()+'.');return}
    const p=offerData.product
    const line:CartLine={key:lineKey(p.id,selections),productId:p.id,name:p.name,sku:p.sku,quantity,price:offer.price,selections:{...selections},image:p.images?.[0]||'',unitsPerBox:offer.unitsPerBox}
    const previous=readCart(storeSlug,offer.slug)
    const items=previous?.items||[]
    const found=items.find(i=>i.key===line.key)
    persistCart(storeSlug,{catalog:offer,items:found?items.map(i=>i.key===line.key?{...i,quantity:i.quantity+quantity,price:offer.price}:i):[...items,line]})
    reloadCart();setCatalogSlug(offer.slug);setStep('cart');setError('')
  }
  const changeQty=(key:string,delta:number)=>{
    if(!activeCart)return
    persistCart(storeSlug,{...activeCart,items:activeCart.items.map(i=>i.key===key?{...i,quantity:Math.max(0,i.quantity+delta)}:i).filter(i=>i.quantity>0)})
    reloadCart()
  }
  const askSeller=async()=>{
    if(!offerData||busy)return
    setBusy(true);setError('')
    try{
      const r=await fetch('/api/social/posts/'+encodeURIComponent(offerData.product.id)+'/ask',{method:'POST',credentials:'include'})
      const data=await parseJson(r)
      if(!r.ok||!data.whatsappUrl)throw Error(data.error||'Não foi possível abrir a conversa.')
      window.open(data.whatsappUrl,'_blank','noopener,noreferrer')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível conversar com a loja.')}
    finally{setBusy(false)}
  }
    const submit=async()=>{
    if(!activeCart||!activeCart.items.length||total<minimum||busy)return
    setBusy(true);setError('')
    try{
      const signature=JSON.stringify({buyerId:buyer?.id||'',items:activeCart.items.map(i=>({id:i.productId,qty:i.quantity,selections:i.selections}))})
      try {
        const previous=JSON.parse(sessionStorage.getItem(readyKey(storeSlug,activeCart.catalog.slug))||'null') as {signature:string;code:string;url:string;at:number}|null
        if(previous?.signature===signature && Date.now()-previous.at<30*60_000){
          setReady({code:previous.code,url:previous.url});setStep('ready');return
        }
      }catch{ /* pedido antigo não está disponível */ }
      // Product prices may change while a buyer browses. Re-validate the offer
      // and request an explicit review before preparing the order.
      const refreshed:CartLine[]=[]
      for(const line of activeCart.items){
        const response=await fetch(`/api/social/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(line.productId)}/offers`,{credentials:'include',cache:'no-store'})
        const data=await parseJson(response)
        if(!response.ok)throw Error(data.error||'Não foi possível validar o preço.')
        const match=(data.offers as Offer[]).find(o=>o.slug===activeCart.catalog.slug)
        if(!match)throw Error(line.name+' não está mais disponível neste catálogo.')
        refreshed.push({...line,price:match.price,unitsPerBox:match.unitsPerBox})
      }
      if(refreshed.some((x,i)=>x.price!==activeCart.items[i].price||x.unitsPerBox!==activeCart.items[i].unitsPerBox)){
        persistCart(storeSlug,{...activeCart,items:refreshed});reloadCart();setStep('cart')
        throw Error('Os preços foram atualizados. Confira novamente o carrinho antes de continuar.')
      }
      const response=await fetch('/api/social/orders',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        storeSlug,catalogSlug:activeCart.catalog.slug,sellerSlug:seller?.slug||'',items:activeCart.items.map(i=>({productId:i.productId,quantity:i.quantity,selections:i.selections})),
        buyer:{name:buyer?.name||'',phone:buyer?.phone||'',city:buyer?.city||''},notes
      })})
      const data=await parseJson(response)
      if(!response.ok)throw Error(data.error||'Não foi possível preparar o pedido.')
      if(!data.code||!data.whatsappUrl)throw Error('O servidor não confirmou o pedido.')
      try{sessionStorage.setItem(readyKey(storeSlug,activeCart.catalog.slug),JSON.stringify({signature,code:data.code,url:data.whatsappUrl,at:Date.now()}))}catch{}
      setReady({code:data.code,url:data.whatsappUrl});setStep('ready')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar o pedido.')}
    finally{setBusy(false)}
  }

  return <div className="svx-social-shop-layer" role="presentation">
    <button className="svx-social-shop-backdrop" type="button" onClick={onClose} aria-label="Fechar compra" disabled={busy}/>
    <section className="svx-social-shop" role="dialog" aria-modal="true" aria-labelledby="svx-social-shop-title">
      <header className="svx-social-shop-head">
        <div><small>{storeName||storeSlug} · compra pelo feed</small><h2 id="svx-social-shop-title">{step==='auth'?'Ver preços':step==='item'?offerData?.product.name:step==='ready'?'Pedido preparado':'Seu pedido'}</h2></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20}/></button>
      </header>
      <div className="svx-social-shop-body">
        {step==='loading'&&<p role="status">Abrindo…</p>}
        {step==='error'&&<><p role="alert">{error}</p><button className="svx-social-shop-primary" onClick={()=>void load()}>Tentar novamente</button></>}
        {step==='auth'&&<><p className="svx-social-shop-description">Para ver valores e comprar, confirme seu WhatsApp e informe se compra no varejo, atacado ou em ambos. Você volta ao mesmo produto.</p><BuyerWhatsappLogin storeSlug={storeSlug} onVerified={load}/></>}
        {step==='item'&&offerData&&offer&&<>
          {offerData.product.description&&<p className="svx-social-shop-description">{offerData.product.description}</p>}
          <p className="svx-social-shop-label">Como deseja comprar?</p>
          <div className="svx-social-offers">{offerData.offers.map(x=><button type="button" key={x.id} className={offer.slug===x.slug?'is-selected':''} onClick={()=>selectOffer(x)}>
            <span><strong>{x.name}</strong><small>{x.kind==='atacado'?'Atacado':x.kind==='varejo'?'Varejo':'Catálogo da loja'}</small></span><b>{money.format(x.price)}</b>
          </button>)}</div>
          {offer.unitsPerBox>1&&<p className="svx-social-shop-hint">1 caixa contém {offer.unitsPerBox} unidades. O preço exibido é por caixa.</p>}
          <p className="svx-social-shop-hint">Pedido mínimo neste catálogo: {money.format(offer.minimumOrder)}</p>
          {(offerData.product.variations||[]).map(v=><div key={v.name} className="svx-social-shop-field"><strong>{v.name}</strong><div className="svx-social-options">{v.options.map(o=><button type="button" key={o} className={selections[v.name]===o?'is-selected':''} onClick={()=>{setSelections(s=>({...s,[v.name]:o}));setError('')}}>{o}</button>)}</div></div>)}
          <div className="svx-social-qty"><span>Quantidade {offer.unitsPerBox>1?'de caixas':'de itens'}</span><div><button type="button" aria-label="Diminuir" onClick={()=>setQuantity(n=>Math.max(1,n-1))}><Minus size={16}/></button><strong>{quantity}</strong><button type="button" aria-label="Aumentar" onClick={()=>setQuantity(n=>Math.min(999,n+1))}><Plus size={16}/></button></div></div>
          <button className="svx-social-shop-primary" onClick={addItem}><ShoppingBag size={18}/> Adicionar · {money.format(offer.price*quantity)}</button>
          <button className="svx-social-shop-secondary" disabled={busy} onClick={()=>void askSeller()}>{busy?'Abrindo…':'Perguntar à vendedora'}</button>
        </>}
        {step==='cart'&&<>
          {storedCarts.length>1&&<div className="svx-social-shop-tabs">{catalogOptions.map(c=><button type="button" key={c.slug} className={c.slug===catalogSlug?'is-selected':''} onClick={()=>setCatalogSlug(c.slug)}>{c.name}</button>)}</div>}
          {activeCart?.items.length?<>
            <p className="svx-social-shop-hint">Catálogo: {activeCart.catalog.name}</p>
            {activeCart.items.map(i=><article className="svx-social-cart-line" key={i.key}>
              {i.image&&<img src={i.image} loading="lazy" alt=""/>}
              <div><strong>{i.name}</strong><small>{Object.entries(i.selections).map(([k,v])=>k+': '+v).join(' · ')||i.sku}</small>{i.unitsPerBox>1&&<small>{i.unitsPerBox} unidades por caixa</small>}<b>{money.format(i.price*i.quantity)}</b></div>
              <div className="svx-social-cart-qty"><button aria-label="Remover uma unidade" onClick={()=>changeQty(i.key,-1)}><Minus size={14}/></button><span>{i.quantity}</span><button aria-label="Adicionar uma unidade" onClick={()=>changeQty(i.key,1)}><Plus size={14}/></button></div>
            </article>)}
            <div className="svx-social-cart-totals"><div><span>Total</span><strong>{money.format(total)}</strong></div><div><span>Pedido mínimo</span><b>{money.format(minimum)}</b></div>{total<minimum&&<p>Faltam {money.format(minimum-total)} para atingir o mínimo.</p>}</div>
            <button className="svx-social-shop-primary" disabled={total<minimum} onClick={()=>{setError('');setStep('review')}}>Revisar pedido</button>
            {productId&&<button className="svx-social-shop-secondary" onClick={()=>setStep('item')}>Continuar escolhendo este produto</button>}
          </>:<><p>Seu carrinho desta loja está vazio.</p>{productId&&<button className="svx-social-shop-primary" onClick={()=>setStep('item')}>Escolher produto</button>}</>}
        </>}
        {step==='review'&&activeCart&&<>
          <button className="svx-social-shop-back" onClick={()=>setStep('cart')}><ArrowLeft size={16}/> Voltar ao carrinho</button>
          <p>Revise os produtos da {storeName||storeSlug}{seller?.name?' com atendimento de '+seller.name:''} antes de abrir o WhatsApp.</p>
          {activeCart.items.map(i=><div className="svx-social-review-line" key={i.key}><span>{i.quantity}× {i.name}</span><b>{money.format(i.price*i.quantity)}</b></div>)}
          <div className="svx-social-cart-totals"><div><span>Total</span><strong>{money.format(total)}</strong></div></div>
          <label className="svx-social-shop-field"><strong>Observações (opcional)</strong><textarea maxLength={500} rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Informações para a vendedora"/></label>
          <button className="svx-social-shop-primary" disabled={busy} onClick={()=>void submit()}>{busy?'Preparando…':'Preparar pedido para o WhatsApp'}</button>
          <p className="svx-social-shop-hint">Preparar um pedido não confirma pagamento nem prova que a mensagem foi enviada.</p>
        </>}
        {step==='ready'&&ready&&<div className="svx-social-ready"><Check size={28}/><h3>Pedido {ready.code} preparado</h3><p>Abra o WhatsApp para falar com a vendedora. Seu carrinho foi preservado.</p><a className="svx-social-shop-primary" href={ready.url} target="_blank" rel="noopener noreferrer">Continuar no WhatsApp</a><button className="svx-social-shop-secondary" onClick={onClose}>Voltar ao feed</button></div>}
        {error&&step!=='error'&&<p className="svx-social-shop-error" role="alert">{error}</p>}
      </div>
    </section>
  </div>
}
