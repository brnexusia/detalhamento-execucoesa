import { Play, Search, SlidersHorizontal, Store } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buyerGo } from './BuyerAppNav'
import BuyerSearchAutocomplete from './BuyerSearchAutocomplete'
import './buyer-app.css'

type ResultProduct={id:string;name:string;sku:string;category:string;mediaUrl:string;thumbnailUrl?:string;mediaType:'image'|'video';price?:number;priceFrom?:boolean;store:{id:string;slug:string;name:string;logoUrl?:string}}
type ResultStore={id:string;slug:string;name:string;logoUrl:string;tagline:string;productCount:number}
type ResponseData={products:ResultProduct[];stores:ResultStore[];categories:string[]}
const start=()=>new URLSearchParams(location.search)
function navTo(path:string,e:React.MouseEvent<HTMLAnchorElement>){if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();buyerGo(path)}
export default function SocialDiscover(){
 const [query,setQuery]=useState(()=>start().get('q')||'')
 const [category,setCategory]=useState(()=>start().get('category')||'')
 const [mode,setMode]=useState(()=>start().get('mode')||'')
 const [minPrice,setMinPrice]=useState(()=>start().get('minPrice')||'')
 const [maxPrice,setMaxPrice]=useState(()=>start().get('maxPrice')||'')
 const [results,setResults]=useState<ResponseData>({products:[],stores:[],categories:[]})
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [needsLogin,setNeedsLogin]=useState(false)
 const [retry,setRetry]=useState(0)
 const [loadedKey,setLoadedKey]=useState('')
 const currentKey=[query.trim(),category,mode,minPrice,maxPrice].join('\u001f')
 useEffect(()=>{
  const params=new URLSearchParams()
  if(query.trim())params.set('q',query.trim())
  if(category)params.set('category',category)
  if(mode)params.set('mode',mode)
  if(minPrice)params.set('minPrice',minPrice)
  if(maxPrice)params.set('maxPrice',maxPrice)
  const suffix=params.toString()
  window.history.replaceState(window.history.state,'','/buscar'+(suffix?'?'+suffix:''))
  const controller=new AbortController()
  const timeout=window.setTimeout(async()=>{
   setLoading(true);setError('');setNeedsLogin(false)
   try{
    const r=await fetch('/api/social/discover'+(suffix?'?'+suffix:''),{signal:controller.signal,credentials:'include'})
    const contentType=r.headers.get('content-type')||''
    if(!contentType.toLowerCase().includes('application/json'))throw Error('O servidor retornou uma página em vez dos dados de pesquisa.')
    const body=await r.json().catch(()=>{throw Error('O servidor retornou uma resposta inválida para a pesquisa.')})
    if(r.status===401){
      setNeedsLogin(true);setError('Entre com WhatsApp para filtrar por preços.');return
    }
    if(!r.ok)throw Error(body.error||'Não foi possível buscar produtos.')
    if(!Array.isArray(body.products)||!Array.isArray(body.stores))throw Error('A pesquisa não retornou listas válidas de produtos e lojas.')
    setResults({products:body.products,stores:body.stores,categories:Array.isArray(body.categories)?body.categories:[]})
    setLoadedKey([query.trim(),category,mode,minPrice,maxPrice].join('\u001f'))
   }catch(e){
    if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível buscar.')
   }finally{if(!controller.signal.aborted)setLoading(false)}
  },280)
  return()=>{controller.abort();clearTimeout(timeout)}
 },[query,category,mode,minPrice,maxPrice,retry])
 const login=()=>buyerGo('/comprador?next='+encodeURIComponent('/buscar'+location.search))
 const empty=!results.products.length&&!results.stores.length
 return <main className="buyer-screen">
   <div className="buyer-screen__inner">
     <header className="buyer-screen__head"><div><small>Explorar ShopVax</small><h1>O que você procura?</h1></div><Search size={23}/></header>
     <BuyerSearchAutocomplete query={query} onQuery={setQuery} products={results.products} stores={results.stores}
       ready={!loading&&!error&&!needsLogin&&currentKey===loadedKey}/>
     <div className="buyer-chips" aria-label="Categorias">
       <button type="button" aria-pressed={!category} onClick={()=>setCategory('')}>Tudo</button>
       {results.categories.map(c=><button type="button" key={c} aria-pressed={category===c} onClick={()=>setCategory(v=>v===c?'':c)}>{c}</button>)}
     </div>
     <div className="buyer-filters" role="group" aria-label="Filtros de produtos">
       <span className="buyer-filters__title"><SlidersHorizontal size={18}/> Filtros</span>
       <div className="buyer-filter-field buyer-filter-field--mode">
         <label htmlFor="svx-mode">Compra</label>
         <select id="svx-mode" value={mode} onChange={e=>setMode(e.target.value)}>
           <option value="">Todas</option><option value="varejo">Varejo</option><option value="atacado">Atacado</option><option value="caixa_fechada">Caixa fechada</option><option value="personalizado">Personalizado</option>
         </select>
       </div>
       <div className="buyer-filter-field">
         <label htmlFor="svx-min">Preço de</label>
         <input id="svx-min" type="number" min="0" step="0.01" inputMode="decimal" placeholder="R$ mín." value={minPrice} onChange={e=>setMinPrice(e.target.value)}/>
       </div>
       <div className="buyer-filter-field">
         <label htmlFor="svx-max">Até</label>
         <input id="svx-max" type="number" min="0" step="0.01" inputMode="decimal" placeholder="R$ máx." value={maxPrice} onChange={e=>setMaxPrice(e.target.value)}/>
       </div>
     </div>
     {needsLogin&&<div className="buyer-empty"><p>{error}</p><button className="buyer-primary-button" onClick={login}>Entrar para filtrar preços</button>
       <p>Você pode pesquisar produtos e lojas sem conta. Só a pesquisa por valores exige identificação.</p></div>}
     {error&&!needsLogin&&<div className="buyer-empty" role="alert"><p>{error}</p><button type="button" className="buyer-primary-button" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</button></div>}
     {loading&&<p className="buyer-state" role="status">Buscando produtos e lojas…</p>}
     {!loading&&!needsLogin&&!error&&<>
       {query.trim()&&<p className="buyer-search-count" role="status">{results.stores.length} {results.stores.length===1?'loja':'lojas'} e {results.products.length} {results.products.length===1?'produto':'produtos'} encontrados para “{query.trim()}”</p>}
       {results.stores.length>0&&<section className="buyer-section"><h2 className="buyer-section__heading">Lojas</h2>
         <div className="buyer-stores">{results.stores.map(store=><a className="buyer-store-card" key={store.id} href={'/perfil/'+encodeURIComponent(store.slug)} onClick={e=>navTo('/perfil/'+encodeURIComponent(store.slug),e)}>
           <span className="buyer-store-card__avatar">{store.logoUrl?<img src={store.logoUrl} alt="" loading="lazy"/>:<Store size={22}/>}</span>
           <span className="buyer-store-card__body"><strong>{store.name}</strong><small>{store.productCount} produtos publicados</small></span>
         </a>)}</div></section>}
       <section className="buyer-section"><h2 className="buyer-section__heading">{query.trim()?'Produtos encontrados':'Novidades das lojas'}</h2>
         {results.products.length?<div className="buyer-product-grid">{results.products.map(p=>{
           const path='/perfil/'+encodeURIComponent(p.store.slug)+'?produto='+encodeURIComponent(p.id)
           return <a className="buyer-product-card" key={p.id} href={path} onClick={e=>navTo(path,e)}>
             <span className="buyer-product-card__image">{p.mediaType==='video'?(p.thumbnailUrl?<img src={p.thumbnailUrl} alt={p.name} loading="lazy"/>:<span className="buyer-video-placeholder"><Play size={25}/><small>Vídeo</small></span>):p.mediaUrl?<img src={p.mediaUrl} alt={p.name} loading="lazy"/>:<Store size={25}/>}</span>
             <span className="buyer-product-card__details"><strong>{p.name}</strong><small>{p.store.name} · {p.category}</small>{typeof p.price==='number'?<b className="buyer-price">{p.priceFrom?'A partir de ':''}{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(p.price)}</b>:null}<em>{typeof p.price==='number'?'Ver produto / Comprar':'Ver preço / Comprar'}</em></span>
           </a>
         })}</div>:<div className="buyer-empty">{empty?(query.trim()?'Nenhuma loja ou produto publicado corresponde à sua busca. Tente outro nome ou referência.':'Ainda não há produtos ou lojas publicados para descoberta.'):'Nenhum produto encontrado com esses filtros.'}</div>}
       </section>
     </>}
   </div>
 </main>
}
