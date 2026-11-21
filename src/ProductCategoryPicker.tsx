import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, ChevronDown, Folder, Plus, Search, X } from 'lucide-react'
import { api } from './api'
import { categoryKey, categoryLabel, categoryMatches } from './product-category-utils'
import './product-category-picker.css'

export default function ProductCategoryPicker({value,onChange}:{value:string;onChange:(name:string)=>void}){
  const [open,setOpen]=useState(false)
  const [mode,setMode]=useState<'select'|'create'>('select')
  const [query,setQuery]=useState('')
  const [draftName,setDraftName]=useState('')
  const [names,setNames]=useState<string[]>([])
  const [status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle')
  const [confirmSimilar,setConfirmSimilar]=useState(false)
  const dialog=useRef<HTMLDialogElement>(null)
  const search=useRef<HTMLInputElement>(null)
  const nameInput=useRef<HTMLInputElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  const load=()=>{
    setStatus('loading')
    api.listAdminProductCategories().then(result=>{
      setNames(result.categories.map(item=>item.category));setStatus('ready')
    }).catch(()=>setStatus('error'))
  }
  useEffect(()=>{
    if(!open)return
    const element=dialog.current
    if(element&&!element.open)element.showModal()
    return ()=>{if(element?.open)element.close()}
  },[open])
  useEffect(()=>{
    if(!open)return
    if(mode==='create')nameInput.current?.focus()
    else search.current?.focus()
  },[open,mode])
  const close=()=>{
    dialog.current?.close()
    setOpen(false)
    trigger.current?.focus()
  }
  const choose=(name:string)=>{onChange(name);close()}
  const openPicker=()=>{
    setMode('select');setQuery('');setDraftName('');setConfirmSimilar(false);setOpen(true);load()
  }
  const beginCreate=()=>{
    setDraftName(query.trim());setConfirmSimilar(false);setMode('create')
  }
  const options=Array.from(new Set(['Geral',...(value?[value]:[]),...names])).sort((a,b)=>a.localeCompare(b,'pt-BR'))
  const {exact,matches,similar}=categoryMatches(options,query)
  const proposed=categoryLabel(draftName)
  const draftMatches=categoryMatches(options,draftName)
  const canCreate=status==='ready'&&Boolean(proposed)&&(!draftMatches.similar.length||confirmSimilar)
  const saveCategory=()=>{
    if(status!=='ready'||!proposed)return
    if(draftMatches.exact){choose(draftMatches.exact);return}
    if(canCreate)choose(proposed)
  }
  const option=(name:string)=>{
    const selected=categoryKey(name)===categoryKey(value||'Geral')
    return <button type="button" key={name} className={'svx-category-option'+(selected?' is-selected':'')} aria-pressed={selected} onClick={()=>choose(name)}><Folder size={18} aria-hidden="true"/><span>{name}</span>{selected&&<Check size={18} aria-hidden="true"/>}</button>
  }
  const content=open&&createPortal(
    <dialog ref={dialog} className="svx-category-modal" aria-labelledby="product-category-modal-title"
      onCancel={e=>{e.preventDefault();close()}}
      onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close()}}}
      onKeyDown={e=>{e.stopPropagation()}}>
      <div className="svx-category-shell">
        <header className="svx-category-modal-head">
          {mode==='create'&&<button type="button" className="svx-category-icon-button" aria-label="Voltar para categorias" onClick={()=>setMode('select')}><ArrowLeft size={20}/></button>}
          <div><h2 id="product-category-modal-title">{mode==='select'?'Selecionar categoria':'Nova categoria'}</h2><p>{mode==='select'?'Escolha uma categoria da sua loja.':'Dê um nome à nova categoria.'}</p></div>
          <button type="button" className="svx-category-icon-button" aria-label="Fechar categorias" onClick={close}><X size={22}/></button>
        </header>
        {mode==='select'?<>
          <div className="svx-category-search"><Search size={18} aria-hidden="true"/><input ref={search} aria-label="Buscar categoria" placeholder="Pesquisar categorias" value={query} maxLength={80} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(exact)choose(exact)}}}/>{query&&<button type="button" className="svx-category-icon-button" aria-label="Limpar pesquisa" onClick={()=>{setQuery('');search.current?.focus()}}><X size={16}/></button>}</div>
          <div className="svx-category-scroll">
            {status==='loading'&&<p className="svx-category-message" role="status">Carregando categorias…</p>}
            {status==='error'&&<div className="svx-category-message"><p role="alert">Não foi possível carregar as categorias.</p><button type="button" className="svx-category-secondary" onClick={load}>Tentar novamente</button></div>}
            {matches.length>0&&<div className="svx-category-options" aria-label="Categorias existentes">{matches.map(option)}</div>}
            {similar.length>0&&<div className="svx-category-suggestions"><p>Você quis dizer?</p>{similar.map(option)}</div>}
            {status==='ready'&&!matches.length&&!similar.length&&<p className="svx-category-message">Nenhuma categoria encontrada. Você pode criar uma nova.</p>}
          </div>
          <footer className="svx-category-footer"><button type="button" className="svx-category-primary" onClick={beginCreate} disabled={status!=='ready'}><Plus size={19}/> Criar nova categoria</button></footer>
        </>:<>
          <div className="svx-category-scroll svx-category-create-body">
            <label htmlFor="product-category-new-name">Nome da categoria</label>
            <input id="product-category-new-name" ref={nameInput} placeholder="Ex.: Colares" value={draftName} maxLength={80} onChange={e=>{setDraftName(e.target.value);setConfirmSimilar(false)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveCategory()}}}/>
            {draftMatches.exact&&<div className="svx-category-suggestions"><p>Essa categoria já existe. Selecione para evitar duplicatas.</p>{option(draftMatches.exact)}</div>}
            {!draftMatches.exact&&draftMatches.similar.length>0&&<div className="svx-category-suggestions"><p>Encontramos categorias parecidas. Você quis dizer?</p>{draftMatches.similar.map(option)}<label className="svx-category-confirm"><input type="checkbox" checked={confirmSimilar} onChange={e=>setConfirmSimilar(e.target.checked)}/> Quero criar uma categoria diferente.</label></div>}
            <small>A categoria será criada ao salvar o produto.</small>
          </div>
          <footer className="svx-category-footer"><button type="button" className="svx-category-secondary" onClick={()=>setMode('select')}>Voltar</button><button type="button" className="svx-category-primary" onClick={saveCategory} disabled={!proposed||(!draftMatches.exact&&!canCreate)}>{draftMatches.exact?'Usar categoria existente':'Criar e selecionar'}</button></footer>
        </>}
      </div>
    </dialog>,document.body)
  return <div className="svx-category-picker">
    <label id="product-category-label">Categoria</label>
    <button ref={trigger} type="button" className="svx-category-trigger" aria-labelledby="product-category-label product-category-value" aria-haspopup="dialog" aria-expanded={open} onClick={openPicker}><span id="product-category-value">{value||'Geral'}</span><ChevronDown size={16} aria-hidden="true"/></button>
    {content}
  </div>
}
