import { Plus, Trash2 } from 'lucide-react'
import type { PricingFields } from './ProductPriceEditor'
import type { VariationGroup, VariantImageGroup } from './types'
import './product-variations-editor.css'

const isColor=(name:string)=>/^(cor|cores|color|colors)$/i.test(name.trim())
const isSize=(name:string)=>/^(tamanho|tamanhos|size|sizes)$/i.test(name.trim())
const canonical=(name:string)=>isColor(name)?'Cor':isSize(name)?'Tamanho':name.trim()
const clean=(options:string[])=>[...new Set(options.map(o=>o.trim()).filter(Boolean))]
export function draftGroups(value:PricingFields):VariationGroup[]{
  return [...(value.pricingMode==='multiple'&&value.priceGroup.trim()?[{name:value.priceGroup.trim(),options:clean(value.priceRows.map(r=>r.name))}]:[]),...value.otherVariations.map(g=>({name:g.name.trim(),options:clean(g.options)}))].filter(g=>g.name&&g.options.length)
}
export function stockKey(selections:Record<string,string>){
  return Object.entries(selections).sort(([a],[b])=>a.localeCompare(b,'pt-BR')).map(([k,v])=>k+'='+v).join('|')
}
export function stockCombinations(groups:VariationGroup[],limit=1000){
  if(!groups.length)return []
  let rows:Record<string,string>[]=[{}]
  for(const group of groups){
    if(rows.length*group.options.length>limit)return null
    rows=rows.flatMap(row=>group.options.map(option=>({...row,[group.name]:option})))
  }
  return rows
}
export function validVariantImages(groups:VariationGroup[],images:VariantImageGroup[]){
  return images.filter(g=>Object.keys(g.selections||{}).length>0&&Object.entries(g.selections).every(([key,option])=>groups.some(v=>v.name===key&&v.options.includes(option)))&&g.images.length>0)
}
type Props={value:PricingFields;onChange:(patch:Partial<PricingFields>)=>void;gallery:string[];variantImages:VariantImageGroup[];onImages:(images:VariantImageGroup[])=>void;disabled?:boolean}
export default function ProductVariationsEditor({value,onChange,gallery,variantImages,onImages,disabled}:Props){
  const groups=draftGroups(value)
  const color=groups.find(g=>isColor(g.name))
  const allNames=[...value.otherVariations.map(g=>canonical(g.name)),...(value.pricingMode==='multiple'?[canonical(value.priceGroup)]:[])]
  const add=(name:string,options:string[])=>onChange({otherVariations:[...value.otherVariations,{name,options}]})
  const update=(i:number,patch:Partial<VariationGroup>)=>onChange({otherVariations:value.otherVariations.map((g,j)=>i===j?{...g,...patch}:g)})
  const max=value.pricingMode==='multiple'?4:5
  const canAdd=value.otherVariations.length<max
  const updateOption=(i:number,j:number,next:string)=>update(i,{options:value.otherVariations[i].options.map((o,k)=>k===j?next:o)})
  const setColorPhotos=(name:string,photo:string,checked:boolean)=>{
    if(!color)return
    const match=(g:VariantImageGroup)=>Object.keys(g.selections).length===1&&g.selections[color.name]===name
    const previous=variantImages.find(match)?.images||[]
    const images=checked?[...new Set([...previous,photo])]:previous.filter(p=>p!==photo)
    onImages([...variantImages.filter(g=>!match(g)),...(images.length?[{selections:{[color.name]:name},images}]:[])])
  }
  return <section className="product-inline-section svx-variations-editor" aria-label="Cores e tamanhos">
    <div className="product-inline-section__head"><div><strong>Cores e tamanhos</strong><span>Opções que o comprador seleciona e que aparecem no pedido e no WhatsApp.</span></div></div>
    <div className="svx-variation-quick">
      <button type="button" className="secondary-action" disabled={disabled||!canAdd||allNames.includes('Cor')} onClick={()=>add('Cor',[''])}><Plus size={15}/> Adicionar cores</button>
      <button type="button" className="secondary-action" disabled={disabled||!canAdd||allNames.includes('Tamanho')} onClick={()=>add('Tamanho',['P','M','G'])}><Plus size={15}/> Adicionar tamanhos</button>
      <button type="button" className="secondary-action" disabled={disabled||!canAdd||allNames.includes('Tamanho')} onClick={()=>add('Tamanho',['Único'])}>Tamanho único</button>
      <button type="button" className="secondary-action" disabled={disabled||!canAdd} onClick={()=>add('',[''])}><Plus size={15}/> Outra opção</button>
    </div>
    {!groups.length&&!value.otherVariations.length&&<p className="product-inline-empty">Sem variações. Se cada cor é um produto separado, cadastre apenas a cor correspondente neste produto.</p>}
    {value.pricingMode==='multiple'&&value.priceGroup&&<p className="svx-price-hint">{value.priceGroup}: opções vinculadas a preços diferentes são editadas em Preços do produto.</p>}
    {value.otherVariations.map((group,i)=><div className="svx-other-variation" key={i}>
      <div className="svx-other-head"><label><span>Tipo de opção</span><input value={group.name} placeholder="Ex.: Cor" maxLength={40} disabled={disabled} onChange={e=>update(i,{name:e.target.value})}/></label><button type="button" className="svx-price-remove" disabled={disabled} aria-label={'Remover grupo '+(i+1)} onClick={()=>onChange({otherVariations:value.otherVariations.filter((_,j)=>j!==i)})}><Trash2 size={17}/></button></div>
      {group.options.map((option,j)=><div className="svx-other-option" key={j}><input aria-label={'Opção '+(i+1)+'.'+(j+1)} value={option} maxLength={60} disabled={disabled} placeholder={isColor(group.name)?'Ex.: Bege':isSize(group.name)?'Ex.: M':'Ex.: opção'} onChange={e=>updateOption(i,j,e.target.value)}/><button type="button" className="svx-price-remove" disabled={disabled} aria-label={'Remover opção adicional '+(i+1)+'.'+(j+1)} onClick={()=>update(i,{options:group.options.filter((_,k)=>k!==j)})}><Trash2 size={15}/></button></div>)}
      <button type="button" className="secondary-action" disabled={disabled||group.options.length>=30} onClick={()=>update(i,{options:[...group.options,'']})}><Plus size={15}/> Adicionar valor</button>
    </div>)}
    {color&&<div className="svx-color-photos"><strong>Representação e fotos por cor</strong><p className="svx-price-hint">Escolha a tonalidade visual e associe fotos da galeria geral. Para adicionar novas fotos, use a seção Fotos do produto acima.</p>
      {color.options.map(name=>{
        const swatch=value.colorSwatches?.[name]
        const selected=variantImages.find(g=>Object.keys(g.selections).length===1&&g.selections[color.name]===name)?.images||[]
        return <div className="svx-color-row" key={name}><div className="svx-color-row__heading"><b>{name}</b><label><span>{swatch?'Tonalidade':'Definir tonalidade'}</span><input type="color" value={swatch||'#808080'} disabled={disabled} aria-label={'Tonalidade de '+name} onChange={e=>onChange({colorSwatches:{...value.colorSwatches,[name]:e.target.value}})}/></label>{swatch&&<button type="button" className="secondary-action" disabled={disabled} onClick={()=>onChange({colorSwatches:Object.fromEntries(Object.entries(value.colorSwatches||{}).filter(([key])=>key!==name))})}>Limpar tonalidade</button>}</div>
          <div className="svx-color-photo-grid">{[...new Set([...gallery,...selected])].map((url,i)=><label key={url} className={selected.includes(url)?'is-selected':''}><img src={url} alt={'Foto '+(i+1)+' para '+name}/><input type="checkbox" disabled={disabled} checked={selected.includes(url)} onChange={e=>setColorPhotos(name,url,e.target.checked)} aria-label={'Associar foto '+(i+1)+' à cor '+name}/></label>)}</div>{!gallery.length&&!selected.length&&<small>Adicione fotos à galeria para vinculá-las.</small>}</div>
      })}
    </div>}
  </section>
}
export function VariantStockEditor({groups,stock,onChange,disabled}:{groups:VariationGroup[];stock:Record<string,number>;onChange:(stock:Record<string,number>)=>void;disabled?:boolean}){
  const rows=stockCombinations(groups)
  if(rows===null)return <p role="status">A grade ultrapassa 1.000 combinações. Reduza as opções para editar o estoque por combinação.</p>
  if(!rows.length)return null
  return <details className="svx-pricing-details svx-stock-variants"><summary>Estoque por combinação ({rows.length})</summary><p className="svx-price-hint">Campo vazio usa o saldo geral compartilhado; zero indica indisponível. Preencha todas as combinações para controlar saldos independentes.</p><div className="svx-stock-grid">{rows.map(row=>{
    const key=stockKey(row),label=Object.values(row).join(' · ')
    return <label key={key}><span>{label}</span><input type="number" aria-label={'Estoque '+label} min="0" max="999999999" step="1" placeholder="Saldo geral" disabled={disabled} value={stock[key]??''} onChange={e=>{const next={...stock};if(e.target.value==='')delete next[key];else next[key]=Math.max(0,Math.min(999999999,Math.floor(Number(e.target.value)||0)));onChange(next)}}/></label>
  })}</div></details>
}
