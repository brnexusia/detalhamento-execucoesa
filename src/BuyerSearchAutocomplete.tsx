import { PackageSearch, Search, Store, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export type SearchProduct = {
 id:string;name:string;sku:string;category:string
 store:{id:string;slug:string;name:string}
}
export type SearchStore = {
 id:string;slug:string;name:string;productCount:number
}
type Suggestion = {
 id:string;kind:'loja'|'produto';label:string;description:string
}
type Props = {
 query:string;onQuery:(value:string)=>void;products:SearchProduct[];stores:SearchStore[];ready:boolean
}
function relevance(name:string,query:string){
 const label=name.toLocaleLowerCase('pt-BR'),term=query.toLocaleLowerCase('pt-BR')
 return label===term?0:label.startsWith(term)?1:label.includes(term)?2:3
}
export default function BuyerSearchAutocomplete({query,onQuery,products,stores,ready}:Props){
 const [open,setOpen]=useState(false)
 const [active,setActive]=useState(-1)
 const root=useRef<HTMLDivElement|null>(null)
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{
   if(root.current&&!root.current.contains(event.target as Node)){
    setOpen(false);setActive(-1)
   }
  }
  document.addEventListener('pointerdown',outside)
  return()=>document.removeEventListener('pointerdown',outside)
 },[])
 const candidates=useMemo<Suggestion[]>(()=>!ready?[]:[
  ...stores.map(s=>({id:'loja:'+s.id,kind:'loja' as const,label:s.name,description:'Loja · '+s.productCount+' produtos'})),
  ...products.map(p=>({id:'produto:'+p.id,kind:'produto' as const,label:p.name,description:p.store.name+' · '+(p.sku||p.category)}))
 ],[ready,stores,products])
 const suggestions=useMemo(()=>{
  const value=query.trim()
  return value.length<2?[]:[...candidates].sort((a,b)=>
   relevance(a.label,value)-relevance(b.label,value)||a.label.localeCompare(b.label,'pt-BR')
  ).slice(0,6)
 },[query,candidates])
 const quickPicks=useMemo(()=>{
  if(query.trim()||!ready)return []
  return [...candidates.filter(s=>s.kind==='loja').slice(0,2),...candidates.filter(s=>s.kind==='produto').slice(0,4)]
 },[query,ready,candidates])
 const expanded=open&&ready&&suggestions.length>0
 const select=(suggestion:Suggestion)=>{
  onQuery(suggestion.label);setOpen(false);setActive(-1)
 }
 const keyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
  if(!expanded)return
  if(event.key==='ArrowDown'){
   event.preventDefault();setActive(index=>(index+1)%suggestions.length)
  }else if(event.key==='ArrowUp'){
   event.preventDefault();setActive(index=>index<=0?suggestions.length-1:index-1)
  }else if(event.key==='Escape'){
   event.preventDefault();setOpen(false);setActive(-1)
  }else if((event.key==='Enter'||event.key==='Tab')&&active>=0){
   if(event.key==='Enter')event.preventDefault()
   select(suggestions[active])
  }
 }
 return <div className="buyer-search-area" ref={root}>
  <label className="buyer-search-input" htmlFor="svx-search">
   <Search size={21}/>
   <input id="svx-search" type="search" enterKeyHint="search" autoComplete="off" value={query}
    role="combobox" aria-label="Pesquisar produtos e lojas" aria-autocomplete="list"
    aria-controls={expanded?'svx-search-suggestions':undefined} aria-expanded={expanded}
    aria-activedescendant={expanded&&active>=0?'svx-suggestion-'+active:undefined}
    maxLength={100} placeholder="Produto, referência ou loja…"
    onFocus={()=>setOpen(true)}
    onChange={event=>{onQuery(event.target.value);setActive(-1);setOpen(true)}}
    onKeyDown={keyDown}/>
   {query&&<button type="button" onClick={()=>{onQuery('');setOpen(false);setActive(-1)}} aria-label="Limpar pesquisa"><X size={18}/></button>}
  </label>
  {expanded&&<div id="svx-search-suggestions" className="buyer-suggestion-list" role="listbox" aria-label="Sugestões de produtos e lojas">
   <p className="buyer-suggestion-caption">Toque para completar sua pesquisa</p>
   {suggestions.map((suggestion,index)=><button
     type="button" role="option" id={'svx-suggestion-'+index} key={suggestion.id}
     aria-selected={active===index} className={active===index?'is-active':''}
     onClick={()=>select(suggestion)}>
     {suggestion.kind==='loja'?<Store size={18}/>:<PackageSearch size={18}/>}
     <span><strong>{suggestion.label}</strong><small>{suggestion.description}</small></span>
     <Search size={15}/>
   </button>)}
  </div>}
  {quickPicks.length>0&&<section className="buyer-quick-searches" aria-label="Sugestões reais para começar">
   <p>Sugestões para começar</p>
   <div>{quickPicks.map(suggestion=><button key={suggestion.id} type="button"
     onClick={()=>select(suggestion)} aria-label={'Pesquisar '+suggestion.label}>
     {suggestion.kind==='loja'?<Store size={17}/>:<PackageSearch size={17}/>}
     <span>{suggestion.label}</span>
   </button>)}</div>
  </section>}
 </div>
}
