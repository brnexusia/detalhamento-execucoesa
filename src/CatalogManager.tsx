import { publicCatalogLink, publicStoreLink, publicSellerLink } from './public-share-links'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FolderClosed, FolderOpen, LayoutGrid, List, MoreHorizontal, Plus, Search, Share2, Trash2, X } from 'lucide-react'
import { api, type AdminCatalog } from './api'
import type { AdminProduct, AdminSeller } from './types'
import { confirmAction } from './ui-dialogs'
import './catalog-manager.css'

type Kind = 'varejo'|'atacado'|'alto_atacado'|'personalizado'
type Pane = 'create'|'settings'|'add'|null
type Props = {
 storeSlug:string
 categories:string[]
 sellers?:AdminSeller[]
 onSelect:(catalog:AdminCatalog|null)=>void
 onChanged:()=>void
 onReady?:()=>void
}
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const FOLDERS_PER_PAGE=12
const folderKey=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()
const presetCustomLabels=['Caixa fechada','Pacote','6 unidades'] as const
const kindLabel=(catalog:AdminCatalog)=>catalog.kind==='personalizado'
 ? 'Personalizado · '+(catalog.customLabel||'Outro')
 : catalog.kind==='caixa_fechada'?'Personalizado · Caixa fechada'
 : catalog.kind==='alto_atacado'?'Alto Atacado'
 : catalog.kind==='atacado'?'Atacado'
 : catalog.kind==='varejo'?'Varejo':'Catálogo geral'
function download(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),a=document.createElement('a')
 a.href=url;a.download=filename;document.body.append(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function CatalogManager({storeSlug,categories,sellers=[],onSelect,onChanged,onReady}:Props){
 const [catalogs,setCatalogs]=useState<AdminCatalog[]>([])
 const [gold,setGold]=useState(false)
 const [selectedId,setSelectedId]=useState('')
 const [pane,setPane]=useState<Pane>(null)
 const [name,setName]=useState('')
 const [kind,setKind]=useState<Kind>('varejo')
 const [customLabel,setCustomLabel]=useState('')
 const [customFormat,setCustomFormat]=useState('')
 const [priceMode,setPriceMode]=useState<'base'|'varejo'|'atacado'|'caixa_fechada'>('base')
 const [minimum,setMinimum]=useState('')
 const [active,setActive]=useState(true)
 const [pdfCategory,setPdfCategory]=useState('')
 const [addSearch,setAddSearch]=useState('')
 const [sourceCatalogId,setSourceCatalogId]=useState('')
 const [addSource,setAddSource]=useState('')
 const [candidates,setCandidates]=useState<AdminProduct[]>([])
 const [addChecked,setAddChecked]=useState<string[]>([])
 const [addBusy,setAddBusy]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [linkFeedback,setLinkFeedback]=useState<{id:string;text:string;error:boolean}|null>(null)
 const [linkSellerSlug,setLinkSellerSlug]=useState('')
 const [folderQuery,setFolderQuery]=useState('')
 const [folderPage,setFolderPage]=useState(1)
 const [folderView,setFolderView]=useState<'compact'|'cards'>('compact')
 const [foldersOpen,setFoldersOpen]=useState(false)
 const [linksOpen,setLinksOpen]=useState(false)
 // No selected catalog means all products from the store, including every folder.
 const selected=catalogs.find(c=>c.id===selectedId)||null
 const matchingCatalogs=catalogs.filter(c=>folderKey(c.name).includes(folderKey(folderQuery)))
   .sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||a.name.localeCompare(b.name,'pt-BR'))
 const totalPages=Math.max(1,Math.ceil(matchingCatalogs.length/FOLDERS_PER_PAGE))
 const actualPage=Math.min(folderPage,totalPages)
 const visibleCatalogs=matchingCatalogs.slice((actualPage-1)*FOLDERS_PER_PAGE,actualPage*FOLDERS_PER_PAGE)
 const folderStart=matchingCatalogs.length?(actualPage-1)*FOLDERS_PER_PAGE+1:0
 const folderEnd=Math.min(actualPage*FOLDERS_PER_PAGE,matchingCatalogs.length)
 const changeCustomFormat=(value:string)=>{
   setCustomFormat(value)
   if(value==='outro'){setCustomLabel('');return}
   setCustomLabel(value)
   if(value==='Caixa fechada')setPriceMode('caixa_fechada')
   else if(priceMode==='caixa_fechada')setPriceMode('base')
 }
 const load=async(preferred?:string)=>{
   try{
     const response=await api.catalogs()
     setCatalogs(response.catalogs)
     setGold(response.canCreateMultiple)
     const next=response.catalogs.find(c=>c.id===(preferred===undefined?selectedId:preferred))||null
     setSelectedId(next?.id||'')
     onSelect(next)
     setError('')
   }catch(err){setError(err instanceof Error?err.message:'Não foi possível carregar os catálogos.')}
   finally{onReady?.()}
 }
 useEffect(()=>{void load()},[])
 useEffect(()=>{
   if(!selected)return
   setName(selected.name)
   setKind(selected.kind==='geral'||selected.kind==='caixa_fechada'?'personalizado':selected.kind)
   const label=selected.kind==='geral'?selected.name:selected.kind==='caixa_fechada'?'Caixa fechada':selected.customLabel||''
   setCustomLabel(label)
   setCustomFormat(presetCustomLabels.some(preset=>preset===label)?label:label?'outro':'')
   setPriceMode(selected.kind==='caixa_fechada'?'caixa_fechada':selected.priceMode||'base')
   setMinimum(selected.minimumOrder==null?'':String(selected.minimumOrder))
   setActive(selected.active)
 },[selected?.id])
 useEffect(()=>{
   if(pane!=='add')return
   let valid=true
   const timer=setTimeout(()=>{
     setAddBusy(true)
     void api.listAdminProducts({page:1,limit:30,q:addSearch,catalogId:addSource||undefined}).then(r=>{
       if(valid)setCandidates(r.products)
     }).catch(e=>{if(valid)setError(e instanceof Error?e.message:'Erro ao procurar produtos.')})
       .finally(()=>{if(valid)setAddBusy(false)})
   },200)
   return()=>{valid=false;clearTimeout(timer)}
 },[pane,addSearch,addSource])
 useEffect(()=>{
   if(!pane)return
   const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy)setPane(null)}
   window.addEventListener('keydown',onKey)
   return()=>window.removeEventListener('keydown',onKey)
 },[pane,busy])
 const choose=(catalog:AdminCatalog)=>{
   setSelectedId(catalog.id)
   setFoldersOpen(false)
   setLinksOpen(false)
   onSelect(catalog)
 }
 const chooseAll=()=>{
   setSelectedId('')
   setFoldersOpen(false)
   setLinksOpen(false)
   onSelect(null)
 }
 const activeSellers=sellers.filter(seller=>seller.is_active)
 const selectedSeller=activeSellers.find(seller=>seller.slug===linkSellerSlug)
 const storeLink=selectedSeller?publicSellerLink(storeSlug,selectedSeller.slug):publicStoreLink(storeSlug)
 const catalogLink=(catalog:AdminCatalog)=>publicCatalogLink(storeSlug,catalog.slug,selectedSeller?.slug)
 const copyLink=async(url:string,key:string)=>{
   try{
     await navigator.clipboard.writeText(url)
     setLinkFeedback({id:key,text:'Link copiado.',error:false})
   }catch{
     setLinkFeedback({id:key,text:'Não foi possível copiar automaticamente. Selecione o endereço e copie.',error:true})
   }
 }
 const shareLink=async(url:string,key:string,title:string)=>{
   if(typeof navigator.share!=='function'){await copyLink(url,key);return}
   try{
     await navigator.share({title,url})
     setLinkFeedback({id:key,text:'Compartilhamento iniciado.',error:false})
   }catch(error){
     if((error as Error)?.name!=='AbortError')setLinkFeedback({id:key,text:'Não foi possível compartilhar. Use Copiar.',error:true})
   }
 }
 const linkCard=(type:'store'|'catalog',url:string,disabled=false)=>{
   const key=type+':'+(selected?.id||'')+':'+(selectedSeller?.slug||'')
   const parts=new URL(url)
   const title=type==='store'?(selectedSeller?'Link da vendedora':'Link geral da loja'):'Link desta pasta'
   const description=type==='store'?(selectedSeller?'Abre a loja com atendimento de '+selectedSeller.name+'.':'Abre a vitrine principal, com os produtos da loja.'):(selectedSeller?'Abre esta pasta com atendimento de '+selectedSeller.name+'.':'Abre diretamente os produtos deste catálogo.')
   return <article className={'svx-catalog-share__card'+(disabled?' is-disabled':'')} key={key}>
     <div className="svx-catalog-share__card-heading"><span className="svx-catalog-share__icon">{type==='store'?<ExternalLink size={17} aria-hidden="true"/>:<FolderOpen size={17} aria-hidden="true"/>}</span><div><strong>{title}</strong><small>{description}</small></div></div>
     {disabled?<p className="svx-catalog-card__disabled">Esta pasta está desativada ou bloqueada pelo plano.</p>:<>
       <div className="svx-catalog-share__url" aria-label={title+': '+url} tabIndex={0}><span>{parts.host}</span><strong>{parts.pathname+parts.search}</strong></div>
       <div className="svx-catalog-share__actions">
         <button type="button" onClick={()=>void copyLink(url,key)}><Copy size={15} aria-hidden="true"/> Copiar</button>
         <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true"/> Abrir</a>
         {typeof navigator.share==='function'&&<button type="button" onClick={()=>void shareLink(url,key,title)}><Share2 size={15} aria-hidden="true"/> Compartilhar</button>}
       </div>
       {linkFeedback?.id===key&&<p className="svx-catalog-card__feedback" role={linkFeedback.error?'alert':'status'}>{linkFeedback.text}</p>}
     </>}
   </article>
 }
 const show=(next:Pane)=>{setError('');setMessage('');setPane(next);setAddChecked([]);setAddSearch('');setAddSource('');setSourceCatalogId('')}
 const create=async(e:React.FormEvent)=>{
   e.preventDefault()
   if(!gold||busy||!name.trim())return
   setBusy(true);setError('')
   try{
     const r=await api.createCatalog({name:name.trim(),kind,customLabel:kind==='personalizado'?customLabel.trim():'',priceMode:kind==='personalizado'?priceMode:'base',minimumOrder:minimum===''?null:Number(minimum),sourceCatalogId:sourceCatalogId||undefined})
     await load(r.catalog.id);setFoldersOpen(false);setLinksOpen(false);setPane(null);onChanged()
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
     await load('');setFoldersOpen(false);setLinksOpen(false);setPane(null);onChanged()
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
     <div><h2>Catálogos</h2><p>Visualize todos os produtos ou filtre por pasta.</p></div>
     <div className="svx-catalog-inline__buttons">
       {gold&&<button type="button" className="svx-catalog-inline__create" onClick={()=>{setName('');setKind('varejo');setCustomLabel('');setCustomFormat('');setPriceMode('base');setMinimum('');show('create')}}><Plus size={15}/> Criar catálogo</button>}
       {selected&&<button type="button" className="svx-catalog-inline__more" aria-label="Opções do catálogo selecionado" onClick={()=>show('settings')}><MoreHorizontal size={20}/> <span>Opções</span></button>}
     </div>
   </header>
   <div className="svx-catalog-quickbar" role="group" aria-label="Filtrar produtos por catálogo">
     <button type="button" className={'svx-catalog-quickbar__all'+(!selected?' is-active':'')} aria-pressed={!selected} onClick={chooseAll} disabled={busy}>
       <LayoutGrid size={18} aria-hidden="true"/><span><strong>Todos os produtos</strong><small>Base inteira da loja</small></span>
     </button>
     <button type="button" className={'svx-catalog-quickbar__folders'+(selected?' is-selected':'')} aria-expanded={foldersOpen} aria-controls="svx-catalog-picker" onClick={()=>setFoldersOpen(open=>!open)} disabled={busy}>
       <FolderClosed size={19} aria-hidden="true"/><span><strong>{selected?selected.name:'Escolher uma pasta'}</strong><small>{catalogs.length} {catalogs.length===1?'pasta':'pastas'} disponíveis</small></span><ChevronDown className={foldersOpen?'is-open':''} size={18} aria-hidden="true"/>
     </button>
     {selected&&<button type="button" className="svx-catalog-quickbar__links" aria-expanded={linksOpen} aria-controls="svx-catalog-links" onClick={()=>setLinksOpen(open=>!open)}><Share2 size={17} aria-hidden="true"/> Links e detalhes <ChevronDown className={linksOpen?'is-open':''} size={16} aria-hidden="true"/></button>}
   </div>
   {selected&&<p className="svx-catalog-quickbar__context">Exibindo produtos da pasta <strong>{selected.name}</strong>. <button type="button" onClick={chooseAll}>Ver todos os produtos</button></p>}
   {foldersOpen&&<section id="svx-catalog-picker" className="svx-catalog-picker" aria-label="Escolher catálogo">
   <div className="svx-catalog-toolbar">
     <div className="svx-catalog-toolbar__top">
       <strong>{catalogs.length} {catalogs.length===1?'pasta':'pastas'}</strong>
       <span>Selecione uma pasta para ver produtos, editar ou compartilhar o link.</span>
     </div>
     <div className="svx-catalog-toolbar__controls">
       <label className="svx-catalog-search">
         <Search size={17} aria-hidden="true"/>
         <input type="search" value={folderQuery} aria-label="Buscar pastas" placeholder="Buscar pastas pelo nome" onChange={event=>{setFolderQuery(event.target.value);setFolderPage(1)}}/>
       </label>
       <div className="svx-catalog-view" role="group" aria-label="Visualização das pastas">
         <button type="button" className={folderView==='compact'?'is-active':''} aria-label="Visualização compacta" aria-pressed={folderView==='compact'} onClick={()=>setFolderView('compact')}><List size={18}/><span>Compacta</span></button>
         <button type="button" className={folderView==='cards'?'is-active':''} aria-label="Visualização em cartões" aria-pressed={folderView==='cards'} onClick={()=>setFolderView('cards')}><LayoutGrid size={18}/><span>Cartões</span></button>
       </div>
     </div>
   </div>
   <div className={"svx-catalog-folders"+(folderView==="compact"?" is-compact":"")} role="group" aria-label="Pastas dos catálogos">
     {visibleCatalogs.map(c=>{
       const opened=selected?.id===c.id
       return <button
         type="button"
         key={c.id}
         className={'svx-catalog-folder'+(opened?' is-selected':'')}
         aria-pressed={opened}
         aria-label={c.name}
         title={c.name}
         disabled={busy}
         onClick={()=>choose(c)}
       >
         <span className="svx-catalog-folder__icon" aria-hidden="true">{opened?<FolderOpen size={22}/>:<FolderClosed size={22}/>}</span>
         <span className="svx-catalog-folder__text">
           <strong>{c.name}</strong>
           <small>{kindLabel(c)}</small>
         </span>
         <span className="svx-catalog-folder__state">{c.lockedByPlan?'Bloqueada':c.active?'Publicada':'Não publicada'}</span>
         <span className="svx-catalog-folder__action" aria-hidden="true">{opened?'Pasta aberta':'Abrir pasta'}</span>
       </button>
     })}
   </div>
   {matchingCatalogs.length===0
     ?<div className="svx-catalog-empty" role="status"><Search size={22}/><strong>Nenhuma pasta encontrada</strong><span>Tente outro nome ou limpe a busca.</span><button type="button" onClick={()=>{setFolderQuery('');setFolderPage(1)}}>Limpar busca</button></div>
     :<div className="svx-catalog-pagination">
        <span>Mostrando {folderStart}–{folderEnd} de {matchingCatalogs.length} pastas</span>
        {totalPages>1&&<div className="svx-catalog-pagination__actions">
          <button type="button" aria-label="Página anterior das pastas" disabled={actualPage===1} onClick={()=>setFolderPage(page=>Math.max(1,page-1))}><ChevronLeft size={16}/> Anterior</button>
          <span aria-live="polite">Página {actualPage} de {totalPages}</span>
          <button type="button" aria-label="Próxima página das pastas" disabled={actualPage===totalPages} onClick={()=>setFolderPage(page=>Math.min(totalPages,page+1))}>Próxima <ChevronRight size={16}/></button>
        </div>}
       </div>}
   </section>}
   {selected&&linksOpen&&<section id="svx-catalog-links" className="svx-catalog-folder-details" aria-label={'Pasta '+selected.name}>
     <header className="svx-catalog-folder-details__header">
       <span className="svx-catalog-folder-details__icon" aria-hidden="true"><FolderOpen size={20}/></span>
       <div>
         <h3>{selected.name}</h3>
         <p>{kindLabel(selected)} · {selected.minimumOrder==null?'Mínimo conforme configuração da loja':'Pedido mínimo '+currency.format(selected.minimumOrder)}{selected.isDefault?' · Principal':''}</p>
       </div>
       <span className="svx-catalog-folder-details__count">Pasta selecionada</span>
     </header>
     <section className="svx-catalog-share" aria-label="Links de divulgação">
       <div className="svx-catalog-share__heading"><h4>Links para compartilhar</h4><p>Escolha entre divulgar a loja inteira ou somente esta pasta.</p></div>
       {activeSellers.length>0&&<label className="svx-catalog-share__seller"><span>Quem vai atender o comprador?</span><select aria-label="Vendedora do link" value={selectedSeller?.slug||''} onChange={event=>{setLinkSellerSlug(event.target.value);setLinkFeedback(null)}}><option value="">Atendimento geral da loja</option>{activeSellers.map(seller=><option key={seller.id} value={seller.slug}>{seller.name}</option>)}</select><small>Escolha uma vendedora para enviar o pedido diretamente ao atendimento dela.</small></label>}
       <div className="svx-catalog-share__cards">
         {linkCard('store',storeLink)}
         {linkCard('catalog',catalogLink(selected),!selected.active||selected.lockedByPlan)}
       </div>
     </section>
     <p className="svx-catalog-folder-details__hint">Os produtos e as categorias exibidos abaixo pertencem à pasta <strong>{selected.name}</strong>. Alterar esta pasta não apaga produtos da base da loja.</p>
   </section>}
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
         <label>Origem dos produtos<select aria-label="Catálogo de origem" value={addSource} onChange={e=>{setAddSource(e.target.value);setAddChecked([])}}><option value="">Todos os produtos da loja</option>{catalogs.filter(c=>c.id!==selected?.id&&!c.lockedByPlan).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
         <p>Selecione produtos para incluir em {selected?.name}. O preço seguirá o tipo do catálogo de destino; não serão criadas cópias do estoque.</p>
         {addBusy&&<p>Procurando…</p>}
         <div className="svx-catalog-dialog__candidates">{candidates.map(p=><label key={p.id}><input type="checkbox" checked={addChecked.includes(p.id)} onChange={e=>setAddChecked(curr=>e.target.checked?[...curr,p.id]:curr.filter(id=>id!==p.id))}/><span>{p.name}<small>{p.sku||'Sem referência'}</small></span></label>)}</div>
         <footer><button type="button" onClick={()=>void addProducts()} disabled={!addChecked.length||busy}><Plus size={16}/> Incluir {addChecked.length} produto(s)</button></footer>
       </div>:<form onSubmit={pane==='create'?create:save}>
         <label>Nome<input maxLength={100} required autoFocus value={name} onChange={e=>setName(e.target.value)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>
         <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as Kind)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}>
           <option value="varejo">Varejo</option>
           <option value="atacado">Atacado</option>
           <option value="alto_atacado">Alto Atacado</option>
           <option value="personalizado">Personalizado</option>
         </select></label>
         {kind==='alto_atacado'&&<small>Usa o preço principal por unidade, sem desconto automático nem multiplicação por caixa.</small>}
         {kind==='personalizado'&&<>
           <label>Formato personalizado<select value={customFormat} onChange={e=>changeCustomFormat(e.target.value)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}>
             <option value="">Selecione um formato</option>
             <option value="Caixa fechada">Caixa fechada</option>
             <option value="Pacote">Pacote</option>
             <option value="6 unidades">6 unidades</option>
             <option value="outro">Outro formato</option>
           </select></label>
           {customFormat==='outro'&&<label>Nome do tipo personalizado<input maxLength={60} required value={customLabel} onChange={e=>setCustomLabel(e.target.value)} placeholder="Ex.: Consignado ou Sob encomenda" disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>}
           <label>Qual preço utilizar?<select value={priceMode} onChange={e=>setPriceMode(e.target.value as typeof priceMode)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}>
             <option value="base">Preço principal do produto</option>
             <option value="varejo">Preço de varejo</option>
             <option value="atacado">Preço de atacado (principal)</option>
             <option value="caixa_fechada">Preço por caixa fechada</option>
           </select></label>
         </>}
         {pane==='create'&&<label>Copiar produtos de<select aria-label="Copiar produtos de" value={sourceCatalogId} onChange={e=>setSourceCatalogId(e.target.value)} disabled={busy}><option value="">Começar com catálogo vazio</option><option value="all">Todos os produtos da loja</option>{catalogs.filter(c=>!c.lockedByPlan).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><small>Os produtos são vinculados ao novo catálogo e recebem o preço correspondente ao tipo escolhido, sem duplicação.</small></label>}
         <label>Pedido mínimo (R$)<input type="number" min="0" step="0.01" placeholder="Usar mínimo da loja" value={minimum} onChange={e=>setMinimum(e.target.value)} disabled={busy||Boolean(selected?.lockedByPlan)&&pane==='settings'}/></label>
         {pane==='settings'&&selected&&!selected.isDefault&&<label className="svx-catalog-dialog__check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} disabled={busy||selected.lockedByPlan}/> Catálogo publicado</label>}
         {pane==='settings'&&selected&&!selected.lockedByPlan&&<>
           <div className="svx-catalog-dialog__extra">
             {!selected.isDefault&&<button type="button" onClick={()=>show('add')}><Plus size={16}/> Adicionar produtos</button>}
             <a href={catalogLink(selected)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir link do catálogo</a>
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
