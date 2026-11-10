import { useEffect, useState } from 'react'
import { Check, Copy, Download, ExternalLink, MoreHorizontal, Plus, Search, Share2, Trash2, X } from 'lucide-react'
import { api, type AdminCatalog } from './api'
import type { AdminProduct } from './types'
import { confirmAction } from './ui-dialogs'
import './catalog-manager.css'

type Kind = 'varejo'|'atacado'|'caixa_fechada'|'personalizado'
type Pane = 'create'|'settings'|'add'|null
type Props = {
 storeSlug:string
 categories:string[]
 onSelect:(catalog:AdminCatalog|null)=>void
 onChanged:()=>void
}
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const kindLabel=(catalog:AdminCatalog)=>catalog.kind==='personalizado'?catalog.customLabel||'Personalizado':catalog.kind==='caixa_fechada'?'Caixa fechada':catalog.kind==='atacado'?'Atacado':catalog.kind==='varejo'?'Varejo':'Catálogo geral'
function download(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),a=document.createElement('a')
 a.href=url;a.download=filename;document.body.append(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function CatalogManager({storeSlug,categories,onSelect,onChanged}:Props){
 const [catalogs,setCatalogs]=useState<AdminCatalog[]>([])
 const [gold,setGold]=useState(false)
 const [selectedId,setSelectedId]=useState('')
 const [pane,setPane]=useState<Pane>(null)
 const [name,setName]=useState('')
 const [kind,setKind]=useState<Kind>('varejo')
 const [customLabel,setCustomLabel]=useState('')
 const [priceMode,setPriceMode]=useState<'base'|'varejo'|'atacado'|'caixa_fechada'>('base')
 const [minimum,setMinimum]=useState('')
 const [active,setActive]=useState(true)
 const [pdfCategory,setPdfCategory]=useState('')
 const [addSearch,setAddSearch]=useState('')
 const [candidates,setCandidates]=useState<AdminProduct[]>([])
 const [addChecked,setAddChecked]=useState<string[]>([])
 const [addBusy,setAddBusy]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [linkFeedback,setLinkFeedback]=useState<{id:string;text:string;error:boolean}|null>(null)
 const selected=catalogs.find(c=>c.id===selectedId)||catalogs[0]||null
 const load=async(preferred?:string)=>{
   try{
     const response=await api.catalogs()
     setCatalogs(response.catalogs)
     setGold(response.canCreateMultiple)
     const next=response.catalogs.find(c=>c.id===(preferred||selectedId))||response.catalogs[0]||null
     setSelectedId(next?.id||'')
     onSelect(next)
     setError('')
   }catch(err){setError(err instanceof Error?err.message:'Não foi possível carregar os catálogos.')}
 }
 useEffect(()=>{void load()},[])
 useEffect(()=>{
   if(!selected)return
   setName(selected.name)
   setKind(selected.kind==='geral'?'personalizado':selected.kind)
   setCustomLabel(selected.kind==='geral'?selected.name:selected.customLabel||'')
   setPriceMode(selected.priceMode||'base')
   setMinimum(selected.minimumOrder==null?'':String(selected.minimumOrder))
   setActive(selected.active)
 },[selected?.id])
 useEffect(()=>{
   if(pane!=='add')return
   let valid=true
   const timer=setTimeout(()=>{
     setAddBusy(true)
     void api.listAdminProducts({page:1,limit:30,q:addSearch}).then(r=>{
       if(valid)setCandidates(r.products)
     }).catch(e=>{if(valid)setError(e instanceof Error?e.message:'Erro ao procurar produtos.')})
       .finally(()=>{if(valid)setAddBusy(false)})
   },200)
   return()=>{valid=false;clearTimeout(timer)}
 },[pane,addSearch])
 useEffect(()=>{
   if(!pane)return
   const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)setPane(null)}
   window.addEventListener('keydown',onKey)
   return()=>window.removeEventListener('keydown',onKey)
 },[pane,busy])
 const choose=(catalog:AdminCatalog)=>{setSelectedId(catalog.id);onSelect(catalog)}
 const catalogLink=(catalog:AdminCatalog)=>new URL('/'+encodeURIComponent(storeSlug)+'?catalog='+encodeURIComponent(catalog.slug),window.location.origin).toString()
 const copyLink=async(catalog:AdminCatalog)=>{
   try{
     await navigator.clipboard.writeText(catalogLink(catalog))
     setLinkFeedback({id:catalog.id,text:'Link copiado.',error:false})
   }catch{
     setLinkFeedback({id:catalog.id,text:'Não foi possível copiar automaticamente. Selecione o endereço acima e copie.',error:true})
   }
 }
 const shareLink=async(catalog:AdminCatalog)=>{
   if(typeof navigator.share!=='function'){await copyLink(catalog);return}
   try{
     await navigator.share({title:catalog.name,url:catalogLink(catalog)})
     setLinkFeedback({id:catalog.id,text:'Compartilhamento iniciado.',error:false})
   }catch(error){
     if((error as Error)?.name!=='AbortError')setLinkFeedback({id:catalog.id,text:'Não foi possível compartilhar. Use Copiar link.',error:true})
   }
 }
 const show=(next:Pane)=>{setError('');setMessage('');setPane(next);setAddChecked([]);setAddSearch('')}
 const create=async(e:React.FormEvent)=>{
   e.preventDefault()
   if(!gold||busy||!name.trim())return
   setBusy(true);setError('')
   try{
     const r=await api.createCatalog({name:name.trim(),kind,customLabel:kind==='personalizado'?customLabel.trim():'',priceMode:kind==='personalizado'?priceMode:'base',minimumOrder:minimum===''?null:Number(minimum)})
     await load(r.catalog.id);setPane(null);onChanged()
   }catch(e){setError(e instanceof Error?e.message:'Erro ao criar o catálogo.')}
   finally{setBusy(false)}
 }
 const save=async(e:React.FormEvent)=>{
   e.preventDefault()
   if(!selected||selected.lockedByPlan||busy)return
   setBusy(true);setError('')
   try{
     await api.updateCatalog(selected.id,{name:name.trim(),kind,customLabel:kind==='personalizado'?customLabel.trim():'',priceMode:kind==='personalizado'?priceMode:'base',minimumOrder:minimum===''?null:Number(minimum),active})
     await load(selected.id);setPane(null);onChanged()
   }catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.')}
   finally{setBusy(false)}
 }
 const remove=async()=>{
   if(!selected||selected.isDefault||selected.lockedByPlan||busy)return
   if(!(await confirmAction('Excluir este catálogo? O link deixará de funcionar. Os produtos da loja serão preservados.','Excluir catálogo','Excluir catálogo')))return
   setBusy(true)
   try{
     await api.deleteCatalog(selected.id)
     await load('');setPane(null);onChanged()
   }catch(e){setError(e instanceof Error?e.message:'Falha ao excluir catálogo.')}
   finally{setBusy(false)}
 }
 const exportPdf=async()=>{
   if(!selected||busy)return
   setBusy(true)
   try{const r=await api.downloadCatalogPdf(selected.id,pdfCategory);download(r.blob,r.filename);setMessage('PDF gerado.')}
   catch(e){setError(e instanceof Error?e.message:'Não foi possível gerar o PDF.')}
   finally{setBusy(false)}
 }
 const addProducts=async()=>{
   if(!selected||selected.isDefault||!addChecked.length||busy)return
   setBusy(true);setError('')
   try{
     const result=await api.updateCatalogMembers(selected.id,addChecked,'add')
     setAddChecked([]);setMessage(result.changed+' produto(s) incluído(s).')
     onChanged()
     await load(selected.id)
     setPane(null)
   }catch(e){setError(e instanceof Error?e.message:'Não foi possível incluir produtos.')}
   finally{setBusy(false)}
 }
 return <div className="svx-catalog-inline" aria-label="Catálogos da loja">
   <header className="svx-catalog-inline__header">
     <div><h2>Meus catálogos</h2><p>Selecione o catálogo para organizar seus produtos. Cada catálogo publicado possui um link próprio.</p></div>
     <div className="svx-catalog-inline__buttons">
       {gold&&<button type="button" className="svx-catalog-inline__create" onClick={()=>{setName('');setKind('varejo');setCustomLabel('');setPriceMode('base');setMinimum('');show('create')}}><Plus size={15}/> Criar catálogo</button>}
       <button type="button" className="svx-catalog-inline__more" disabled={!selected} aria-label="Opções do catálogo selecionado" onClick={()=>show('settings')}><MoreHorizontal size={20}/> <span>Opções</span></button>
     </div>
   </header>
   <div className="svx-catalog-inline__cards">
     {catalogs.map(c=>{
       const available=c.active&&!c.lockedByPlan
       const activeSelection=selected?.id===c.id
       return <article key={c.id} className={'svx-catalog-card'+(activeSelection?' is-selected':'')}>
         <div className="svx-catalog-card__top">
           <button type="button" className="svx-catalog-card__name" aria-pressed={activeSelection} disabled={busy} onClick={()=>choose(c)}>{c.name}</button>
           <span className={'svx-catalog-card__status'+(available?' is-published':'')}>{c.lockedByPlan?'Bloqueado pelo plano':c.active?'Publicado':'Não publicado'}</span>
         </div>
         <p className="svx-catalog-card__description">{kindLabel(c)} · {c.minimumOrder==null?'Mínimo conforme configuração da loja':'Pedido mínimo '+currency.format(c.minimumOrder)}{c.isDefault?' · Principal':''}</p>
         {available?<div className="svx-catalog-card__link">
           <label htmlFor={'catalog-link-'+c.id}>Link deste catálogo</label>
           <input id={'catalog-link-'+c.id} readOnly value={catalogLink(c)} onFocus={event=>event.currentTarget.select()} />
           <div className="svx-catalog-card__actions">
             <button type="button" onClick={()=>void copyLink(c)}><Copy size={15} aria-hidden="true"/> Copiar link</button>
             {typeof navigator.share==='function'&&<button type="button" onClick={()=>void shareLink(c)}><Share2 size={15} aria-hidden="true"/> Compartilhar</button>}
             <a href={catalogLink(c)} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true"/> Abrir catálogo</a>
           </div>
         </div>:<p className="svx-catalog-card__disabled">O link deste catálogo não está disponível enquanto ele estiver desativado ou bloqueado pelo plano.</p>}
         {linkFeedback?.id===c.id&&<p className="svx-catalog-card__feedback" role={linkFeedback.error?'alert':'status'}>{linkFeedback.text}</p>}
       </article>
     })}
   </div>
   {error&&!pane&&<p className="svx-catalog-inline__error" role="alert">{error}</p>}
   {pane&&<div className="svx-catalog-dialog">
     <button type="button" className="svx-catalog-dialog__backdrop" aria-label="Fechar" onClick={()=>!busy&&setPane(null)}/>
     <section role="dialog" aria-modal="true" aria-label={pane==='create'?'Criar catálogo':pane==='add'?'Adicionar produtos':'Opções do catálogo'} className="svx-catalog-dialog__card">
       <header><div><small>CATÁLOGOS</small><h2>{pane==='create'?'Criar catálogo':pane==='add'?'Adicionar produtos':selected?.name}</h2></div>
         <button type="button" onClick={()=>setPane(null)} disabled={busy} aria-label="Fechar"><X size={20}/></button></header>
       {error&&<p className="svx-catalog-inline__error" role="alert">{error}</p>}
       {message&&<p role="status"><Check size={15}/> {message}</p>}
       {pane==='add'?<div className="svx-catalog-dialog__add">
         <label><Search size={16}/><input value={addSearch} onChange={e=>{setAddSearch(e.target.value);setAddChecked([])}} placeholder="Buscar produto para adicionar" aria-label="Buscar na base de produtos"/></label>
         <p>Produtos continuam na base da loja. Aqui você apenas os inclui em {selected?.name}.</p>
         {addBusy&&<p>Procurando…</p>}
         <div className="svx-catalog-dialog__candidates">{candidates.map(p=><label key={p.id}><input type="checkbox" checked={addChecked.includes(p.id)} onChange={e=>setAddChecked(curr=>e.target.checked?[...curr,p.id]:curr.filter(id=>id!==p.id))}/><span>{p.name}<small>{p.sku||'Sem referência'}</small></span></label>)}</div>
         <footer><button type="button" onClick={()=>void addProducts()} disabled={!addChecked.length||busy}><Plus size={16}/> Incluir {addChecked.length} produto(s)</button></footer>
       </div>:<form onSubmit={pane==='create'?create:save}>
         <label>Nome<input maxLength={100} required autoFocus value={name} onChange={e=>setName(e.target.value)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>
         <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as Kind)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}>
           <option value="varejo">Varejo</option>
           <option value="atacado">Atacado</option>
           <option value="caixa_fechada">Caixa fechada</option>
           <option value="personalizado">Personalizado</option>
         </select></label>
         {kind==='personalizado'&&<>
           <label>Nome do tipo personalizado<input maxLength={60} required value={customLabel} onChange={e=>setCustomLabel(e.target.value)} placeholder="Ex.: Consignado ou Sob encomenda" disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>
           <label>Qual preço utilizar?<select value={priceMode} onChange={e=>setPriceMode(e.target.value as typeof priceMode)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}>
             <option value="base">Preço principal do produto</option>
             <option value="varejo">Preço de varejo</option>
             <option value="atacado">Preço de atacado (principal)</option>
             <option value="caixa_fechada">Preço por caixa fechada</option>
           </select></label>
         </>}
         <label>Pedido mínimo (R$)<input type="number" min="0" step="0.01" placeholder="Usar mínimo da loja" value={minimum} onChange={e=>setMinimum(e.target.value)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>
         {pane==='settings'&&selected&&!selected.isDefault&&<label className="svx-catalog-dialog__check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} disabled={busy||selected.lockedByPlan}/> Catálogo publicado</label>}
         {pane==='settings'&&selected&&!selected.lockedByPlan&&<>
           <div className="svx-catalog-dialog__extra">
             {!selected.isDefault&&<button type="button" onClick={()=>show('add')}><Plus size={16}/> Adicionar produtos</button>}
             <a href={'/'+encodeURIComponent(storeSlug)+'?catalog='+encodeURIComponent(selected.slug)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir link do catálogo</a>
           </div>
           <label>PDF por categoria<select value={pdfCategory} onChange={e=>setPdfCategory(e.target.value)}><option value="">Todas as categorias</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
           <button type="button" onClick={()=>void exportPdf()} disabled={busy}><Download size={15}/> Gerar PDF</button>
         </>}
         <footer>
           {pane==='settings'&&selected&&!selected.isDefault&&!selected.lockedByPlan&&<button type="button" className="danger" disabled={busy} onClick={()=>void remove()}><Trash2 size={15}/> Excluir catálogo</button>}
           <button type="submit" disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'||!name.trim()||(kind==='personalizado'&&!customLabel.trim())}>{busy?'Salvando…':pane==='create'?'Criar catálogo':'Salvar alterações'}</button>
         </footer>
       </form>}
     </section>
   </div>}
 </div>
}
