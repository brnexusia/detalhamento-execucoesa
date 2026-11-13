import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import BuyerWhatsappLogin from './BuyerWhatsappLogin'
import { allSocialCarts as allCarts, readSocialCart as readCart, persistSocialCart as persistCart, socialReadyKey as readyKey } from './social-cart'
import type { SocialOffer as Offer, SocialCartLine as CartLine } from './social-cart'
import './customer-account.css'
import './social-shopping.css'

type Variant = { name: string; options: string[] }
type Product = { id: string; sku: string; name: string; description: string; category: string; variations: Variant[]; images: string[]; mediaUrl?:string;mediaType?:'image'|'video' }
type OfferPayload = { product: Product; offers: Offer[]; buyerPurpose: string; ownerPreview?: boolean }
type Buyer = { id: string; name: string; phone: string; city: string; profileCompleted: boolean }
type Props = { storeSlug: string; storeName?: string; productId?: string; initialCart?: boolean; initialCatalogSlug?: string; onClose: () => void; onCartChanged?: () => void }
const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })
const parseJson = async (r:Response):Promise<any> => r.json().catch(()=>({}))
const lineKey = (id:string,options:Record<string,string>) => id+':'+Object.entries(options).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('|')
const preferred = (offers:Offer[],purpose:string) => offers.find(x=>purpose==='pessoal'?x.kind==='varejo':purpose==='ambos'?x.kind==='varejo':x.kind==='atacado')||offers.find(x=>purpose!=='pessoal'&&x.kind==='caixa_fechada')||offers[0]

export default function SocialShopping({storeSlug,storeName,productId,initialCart=false,initialCatalogSlug,onClose,onCartChanged}:Props){
  const [step,setStep]=useState<'loading'|'auth'|'owner-view'|'item'|'cart'|'review'|'ready'|'error'>('loading')
  const [offerData,setOfferData]=useState<OfferPayload|null>(null)
  const [offer,setOffer]=useState<Offer|null>(null)
  const [buyer,setBuyer]=useState<Buyer|null>(null)
  const [ownerPreview,setOwnerPreview]=useState(false)
  const [seller,setSeller]=useState<{slug:string;name:string}|null>(null)
  const [catalogSlug,setCatalogSlug]=useState('')
  const [cartRevision,setCartRevision]=useState(0)
  const [selections,setSelections]=useState<Record<string,string>>({})
  const [quantity,setQuantity]=useState(1)
  const [imageIndex,setImageIndex]=useState(0)
  const photos=useMemo(()=>offerData?Array.from(new Set([...(offerData.product.images||[]),...(offerData.product.mediaType==='image'&&offerData.product.mediaUrl?[offerData.product.mediaUrl]:[])].filter(Boolean))).slice(0,8):[],[offerData])
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
      let preview=false
      if(!session.ok){
        if(session.status!==401&&session.status!==403)throw Error('Não foi possível verificar sua conta.')
        // Só o proprietário desta loja pode ver o próprio preço sem perfil de comprador.
        // Um lojista de outra loja NÃO ganha acesso aos preços deste vendedor.
        const ownerResponse=await fetch('/api/auth/me',{credentials:'include',cache:'no-store'})
        if(ownerResponse.ok){
          const identity=await parseJson(ownerResponse)
          preview=typeof identity?.user?.id==='string' && typeof identity?.store?.id==='string' && identity.store.slug===storeSlug
        }else if(ownerResponse.status!==401&&ownerResponse.status!==403){
          throw Error('Não foi possível verificar sua sessão de lojista. Tente novamente.')
        }
        if(!preview){setStep('auth');return false}
        setBuyer(null)
      }else{
        const body=await parseJson(session)
        if(!body?.buyer?.profileCompleted){setStep('auth');return false}
        setBuyer(body.buyer)
      }
      setOwnerPreview(preview)
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
        if(preview && data.ownerPreview!==true)throw Error('Não foi possível confirmar a visualização do proprietário.')
        const first=preferred(data.offers,data.buyerPurpose)
        setOfferData(data);setOffer(first);setCatalogSlug(first.slug);setImageIndex(0)
        setSelections(Object.fromEntries((data.product.variations||[]).filter((v:Variant)=>v.options.length===1).map((v:Variant)=>[v.name,v.options[0]])))
        setStep(preview?'item':initialCart?'cart':'item')
      }else{
        if(preview){setStep('owner-view');return true}
        const carts=allCarts(storeSlug)
        if(carts.length)setCatalogSlug(carts.find(c=>c.catalog.slug===initialCatalogSlug)?.catalog.slug||carts[0].catalog.slug)
        setStep('cart')
      }
      return true
    }catch(e){setError(e instanceof Error?e.message:'Falha ao abrir o pedido.');setStep('error');return false}
  },[storeSlug,productId,initialCart,initialCatalogSlug])

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
        {step==='owner-view'&&<div className="svx-social-owner-preview"><p>Você está autenticado como proprietário desta loja. Para ver preços, abra um produto do feed. Para montar pedidos como comprador, use uma conta de comprador verificada.</p><button type="button" className="svx-social-shop-primary" onClick={()=>{onClose();window.history.pushState({},'', '/painel');window.dispatchEvent(new PopStateEvent('popstate'))}}>Ir ao painel da loja</button></div>}
        {step==='item'&&offerData&&offer&&<>
          {photos.length>0&&<div className="svx-social-gallery">
            <img className="svx-social-gallery__hero" src={photos[Math.min(imageIndex,photos.length-1)]} alt={offerData.product.name} loading="eager"/>
            {photos.length>1&&<div className="svx-social-gallery__thumbs" aria-label="Fotos do produto">{photos.map((src,i)=><button type="button" className={imageIndex===i?'is-active':''} key={i} aria-label={'Ver foto '+(i+1)} onClick={()=>setImageIndex(i)}><img src={src} alt="" loading="lazy"/></button>)}</div>}
          </div>}
          {!photos.length&&offerData.product.mediaType==='video'&&offerData.product.mediaUrl&&
            <video className="svx-social-gallery__hero" src={offerData.product.mediaUrl} controls playsInline preload="metadata" aria-label={'Vídeo de '+offerData.product.name}/>}

          {offerData.product.description&&<p className="svx-social-shop-description">{offerData.product.description}</p>}
          <p className="svx-social-shop-label">{ownerPreview?'Preços cadastrados na sua loja':'Como deseja comprar?'}</p>
          <div className="svx-social-offers">{offerData.offers.map(x=><button type="button" key={x.id} className={offer.slug===x.slug?'is-selected':''} onClick={()=>selectOffer(x)}>
            <span><strong>{x.name}</strong><small>{x.kind==='caixa_fechada'?'Caixa fechada':x.kind==='atacado'?'Atacado':x.kind==='varejo'?'Varejo':x.kind==='personalizado'?x.customLabel||'Personalizado':'Catálogo da loja'}</small></span><b>{money.format(x.price)}</b>
          </button>)}</div>
          {offer.unitsPerBox>1&&<p className="svx-social-shop-hint">1 caixa contém {offer.unitsPerBox} unidades. O preço exibido é por caixa.</p>}
          <p className="svx-social-shop-hint">Pedido mínimo neste catálogo: {money.format(offer.minimumOrder)}</p>
          {ownerPreview&&<div className="svx-social-owner-preview" role="status">Visualização do lojista. Você pode conferir os preços dos seus catálogos sem cadastrar um WhatsApp. Pedidos exigem uma conta de comprador verificada.</div>}
          {!ownerPreview&&(offerData.product.variations||[]).map(v=><div key={v.name} className="svx-social-shop-field"><strong>{v.name}</strong><div className="svx-social-options">{v.options.map(o=><button type="button" key={o} className={selections[v.name]===o?'is-selected':''} onClick={()=>{setSelections(s=>({...s,[v.name]:o}));setError('')}}>{o}</button>)}</div></div>)}
          {!ownerPreview&&<div className="svx-social-qty"><span>Quantidade {offer.unitsPerBox>1?'de caixas':'de itens'}</span><div><button type="button" aria-label="Diminuir" onClick={()=>setQuantity(n=>Math.max(1,n-1))}><Minus size={16}/></button><strong>{quantity}</strong><button type="button" aria-label="Aumentar" onClick={()=>setQuantity(n=>Math.min(999,n+1))}><Plus size={16}/></button></div></div>}
          {!ownerPreview&&<button className="svx-social-shop-primary" onClick={addItem}><ShoppingBag size={18}/> Adicionar · {money.format(offer.price*quantity)}</button>}
          {!ownerPreview&&<button className="svx-social-shop-secondary" disabled={busy} onClick={()=>void askSeller()}>{busy?'Abrindo…':'Perguntar à vendedora'}</button>}
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
