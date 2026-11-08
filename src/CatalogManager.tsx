import { useEffect, useState } from 'react'
import { Check, Download, ExternalLink, FileText, Layers, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api, type AdminCatalog } from './api'
import { confirmAction } from './ui-dialogs'
import './catalog-manager.css'

type CatalogKind = 'geral'|'atacado'|'varejo'
const kindName = (kind:CatalogKind) => kind==='atacado'?'Caixa fechada':kind==='varejo'?'Varejo':'Geral'
const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
function saveDownload(blob:Blob,filename:string){
 const link=URL.createObjectURL(blob),el=document.createElement('a')
 el.href=link;el.download=filename;document.body.append(el);el.click();el.remove()
 window.setTimeout(()=>URL.revokeObjectURL(link),1000)
}
export default function CatalogManager({storeSlug,categories}:{storeSlug:string;categories:string[]}){
 const [catalogs,setCatalogs]=useState<AdminCatalog[]>([])
 const [gold,setGold]=useState(false)
 const [selectedId,setSelectedId]=useState('')
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState('')
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [newName,setNewName]=useState('')
 const [newKind,setNewKind]=useState<CatalogKind>('varejo')
 const [newMinimum,setNewMinimum]=useState('')
 const [name,setName]=useState('')
 const [kind,setKind]=useState<CatalogKind>('geral')
 const [minimum,setMinimum]=useState('')
 const [active,setActive]=useState(true)
 const [pdfCategory,setPdfCategory]=useState('')
 const selected=catalogs.find(x=>x.id===selectedId)||catalogs[0]||null
 const load=async()=>{
  setLoading(true)
  try{
   const response=await api.catalogs()
   setCatalogs(response.catalogs)
   setGold(response.canCreateMultiple===true)
   setSelectedId(x=>response.catalogs.some(c=>c.id===x)?x:response.catalogs[0]?.id||'')
   setError('')
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível carregar catálogos.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[])
 useEffect(()=>{
  if(!selected)return
  setName(selected.name);setKind(selected.kind);setMinimum(selected.minimumOrder==null?'':String(selected.minimumOrder))
  setActive(selected.active);setPdfCategory('')
 },[selected?.id,selected?.name,selected?.minimumOrder,selected?.kind,selected?.active])
 const create=async(e:React.FormEvent)=>{
  e.preventDefault()
  if(!gold)return
  setBusy('create');setError('');setMessage('')
  try{
   const r=await api.createCatalog({name:newName.trim(),kind:newKind,minimumOrder:newMinimum===''?null:Number(newMinimum)})
   setNewName('');setNewMinimum('');await load();setSelectedId(r.catalog.id)
   setMessage('Novo catálogo criado com mínimo independente.')
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível criar o catálogo.')}
  finally{setBusy('')}
 }
 const save=async(e:React.FormEvent)=>{
  e.preventDefault()
  if(!selected||selected.lockedByPlan)return
  setBusy('save');setError('');setMessage('')
  try{
   await api.updateCatalog(selected.id,{name:name.trim(),kind,minimumOrder:minimum===''?null:Number(minimum),active})
   setMessage('Catálogo e pedido mínimo atualizados.');await load()
  }catch(err){setError(err instanceof Error?err.message:'Falha ao salvar catálogo.')}
  finally{setBusy('')}
 }
 const exportPdf=async()=>{
  if(!selected||selected.lockedByPlan)return
  setBusy('pdf');setError('')
  try{
   const file=await api.downloadCatalogPdf(selected.id,pdfCategory)
   saveDownload(file.blob,file.filename)
   setMessage(pdfCategory?'PDF da categoria gerado.':'PDF completo separado por categorias gerado.')
  }catch(err){setError(err instanceof Error?err.message:'Erro ao exportar catálogo.')}
  finally{setBusy('')}
 }
 const remove=async()=>{
  if(!selected||selected.isDefault||selected.lockedByPlan)return
  if(!(await confirmAction('O catálogo será excluído e seus links deixarão de funcionar. Os produtos da loja serão preservados.','Excluir catálogo','Excluir')))return
  setBusy('delete');setError('')
  try{
   await api.deleteCatalog(selected.id)
   setSelectedId('');await load();setMessage('Catálogo excluído. Os produtos foram preservados.')
  }catch(err){setError(err instanceof Error?err.message:'Erro ao excluir catálogo.')}
  finally{setBusy('')}
 }
 const link=selected?window.location.origin+'/'+encodeURIComponent(storeSlug)+'?catalog='+encodeURIComponent(selected.slug):''
 return <section className="svx-catalog-manager" aria-label="Gerenciar catálogos comerciais">
  <div className="svx-catalog-manager__heading"><div><span>CATÁLOGOS COMERCIAIS</span><h2>Catálogos e pedidos mínimos</h2><p>Uma base de produtos, preços diferentes por tipo de catálogo e pedidos mínimos independentes.</p></div>
   <button type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> Atualizar</button>
  </div>
  {error&&<p role="alert" className="svx-catalog-manager__error">{error}</p>}
  {message&&<p role="status" className="svx-catalog-manager__success"><Check size={16}/>{message}</p>}
  {!gold&&<p className="svx-catalog-manager__plan"><Layers size={16}/> Seu plano permite apenas um catálogo. Múltiplos catálogos (como caixa fechada + varejo) são exclusivos do Gold.</p>}
  <div className="svx-catalog-manager__tabs" role="group" aria-label="Selecionar catálogo">
   {catalogs.map(c=><button type="button" key={c.id} className={selected?.id===c.id?'is-active':''} onClick={()=>setSelectedId(c.id)}>
    {c.name}<small>{kindName(c.kind)}{c.lockedByPlan?' · bloqueado pelo plano':''}</small>
   </button>)}
  </div>
  {loading&&!catalogs.length?<p>Carregando catálogos…</p>:selected&&<div className="svx-catalog-manager__body">
   {selected.lockedByPlan?<p className="svx-catalog-manager__plan">Este catálogo foi preservado após a mudança de plano. Faça upgrade para Gold para editar, compartilhar ou exportar novamente.</p>:null}
   <form className="svx-catalog-manager__editor" onSubmit={save}>
    <label>Nome do catálogo<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} required disabled={selected.lockedByPlan}/></label>
    <label>Tipo de catálogo<select value={kind} onChange={e=>setKind(e.target.value as CatalogKind)} disabled={selected.lockedByPlan}>
     <option value="atacado">Caixa fechada</option><option value="varejo">Varejo</option><option value="geral">Geral</option>
    </select></label>
    <label>Pedido mínimo (R$)<input type="number" min="0" step="0.01" placeholder="Usar mínimo da loja" value={minimum} onChange={e=>setMinimum(e.target.value)} disabled={selected.lockedByPlan}/></label>
    {!selected.isDefault&&<label className="svx-catalog-manager__checkbox"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} disabled={selected.lockedByPlan}/> Catálogo publicado</label>}
    <div className="svx-catalog-manager__actions"><button type="submit" disabled={busy!==''||selected.lockedByPlan}><Save size={16}/> Salvar catálogo</button>
     {!selected.isDefault&&<button type="button" disabled={busy!==''||selected.lockedByPlan} onClick={()=>void remove()}><Trash2 size={16}/> Excluir</button>}</div>
   </form>
   {!selected.lockedByPlan&&<div className="svx-catalog-manager__sharing">
    <div><h3><FileText size={18}/> Gerador de PDF</h3><p>PDF completo com seções por categoria ou só uma categoria. Usa o preço e o pedido mínimo deste catálogo.</p></div>
    <label>Categoria para exportar<select value={pdfCategory} onChange={e=>setPdfCategory(e.target.value)}><option value="">Todas as categorias</option>
     {categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <button type="button" disabled={busy!==''} onClick={()=>void exportPdf()}><Download size={16}/>{busy==='pdf'?'Gerando…':'Gerar PDF'}</button>
    <div className="svx-catalog-manager__link"><span>Link exclusivo</span><a href={link} target="_blank" rel="noreferrer">{link}<ExternalLink size={14}/></a><small>Mínimo atual: {money.format(selected.minimumOrder??0)}{selected.minimumOrder==null?' (usa o mínimo da loja)':''}</small></div>
   </div>}
  </div>}
  {gold&&<form className="svx-catalog-manager__create" onSubmit={create}>
   <h3><Plus size={17}/> Adicionar catálogo Gold</h3>
   <label>Nome<input value={newName} onChange={e=>setNewName(e.target.value)} required placeholder="Ex.: Varejo"/></label>
   <label>Tipo<select value={newKind} onChange={e=>setNewKind(e.target.value as CatalogKind)}><option value="atacado">Caixa fechada</option><option value="varejo">Varejo</option><option value="geral">Geral</option></select></label>
   <label>Pedido mínimo (R$)<input type="number" min="0" step="0.01" value={newMinimum} onChange={e=>setNewMinimum(e.target.value)} placeholder="Usar mínimo da loja"/></label>
   <button type="submit" disabled={busy!==''||!newName.trim()}><Plus size={17}/>{busy==='create'?'Criando…':'Criar catálogo'}</button>
  </form>}
 </section>
}
