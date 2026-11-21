
import { useEffect,useRef,useState } from 'react'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { api } from './api'
import { categoryKey,categoryLabel,categoryMatches } from './product-category-utils'
import './product-category-picker.css'

export default function ProductCategoryPicker({value,onChange}:{value:string;onChange:(name:string)=>void}){
  const [open,setOpen]=useState(false)
  const [query,setQuery]=useState('')
  const [names,setNames]=useState<string[]>([])
  const [status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle')
  const [confirmedSimilar,setConfirmedSimilar]=useState(false)
  const root=useRef<HTMLDivElement>(null)
  const input=useRef<HTMLInputElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  const load=()=>{
    setStatus('loading')
    api.listAdminProductCategories().then(result=>{
      setNames(result.categories.map(item=>item.category));setStatus('ready')
    }).catch(()=>setStatus('error'))
  }
  useEffect(()=>{
    if(!open)return
    input.current?.focus()
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',close)
    return ()=>document.removeEventListener('pointerdown',close)
  },[open])
  const options=Array.from(new Set(['Geral',...names,...(value?[value]:[])]))
  const {exact,matches,similar}=categoryMatches(options,query)
  const proposed=categoryLabel(query)
  const choose=(name:string)=>{onChange(name);setOpen(false);setQuery('');setConfirmedSimilar(false);trigger.current?.focus()}
  const openPicker=()=>{
    if(open){setOpen(false);return}
    setQuery('');setConfirmedSimilar(false);setOpen(true);if(status!=='ready')load()
  }
  const option=(name:string)=><button type="button" key={name} className="svx-category-option" onClick={()=>choose(name)}><span>{name}</span>{categoryKey(name)===categoryKey(value||'Geral')&&<Check size={16} aria-label="Selecionada"/>}</button>
  return <div ref={root} className="svx-category-picker" onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);trigger.current?.focus()} }}>
    <label id="product-category-label">Categoria</label>
    <button ref={trigger} type="button" className="svx-category-trigger" aria-labelledby="product-category-label product-category-value" aria-expanded={open} aria-controls="product-category-panel" onClick={openPicker}><span id="product-category-value">{value||'Geral'}</span><ChevronDown size={16}/></button>
    {open&&<div id="product-category-panel" className="svx-category-panel">
      <div className="svx-category-search"><Search size={16} aria-hidden="true"/><input ref={input} aria-label="Buscar categoria" placeholder="Buscar ou criar categoria" value={query} maxLength={80} onChange={e=>{setQuery(e.target.value);setConfirmedSimilar(false)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(exact)choose(exact)}}}/></div>
      {status==='loading'&&<p role="status">Carregando categorias…</p>}
      {status==='error'&&<div><p role="alert">Não foi possível carregar as categorias.</p><button type="button" className="secondary-action" onClick={load}>Tentar novamente</button></div>}
      <div className="svx-category-options" aria-label="Categorias existentes">{matches.map(option)}</div>
      {similar.length>0&&<div className="svx-category-suggestions"><p>Você quis dizer?</p>{similar.map(option)}</div>}
      {status==='ready'&&proposed&&!exact&&<>
        {similar.length>0&&!confirmedSimilar?<button type="button" className="svx-category-create" onClick={()=>setConfirmedSimilar(true)}>Não, criar uma categoria diferente</button>:<button type="button" className="svx-category-create" onClick={()=>choose(proposed)}><Plus size={16}/> Criar “{proposed}”</button>}
        <small>Uma nova categoria só será criada ao salvar o produto.</small>
      </>}
    </div>}
  </div>
}
