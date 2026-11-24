import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { confirmAction } from './ui-dialogs'
import type { AdminProduct, VariationGroup, VariantPrices } from './types'
import './product-price-editor.css'

type PriceRow = { name: string; price: string }
export type PricingFields = {
  price: string; retailPrice: string; boxPrice: string; unitsPerBox: string
  catalogId?: string; catalogPrice?: string; originalCatalogPrice?: string
  pricingMode: 'single' | 'multiple'; priceGroup: string; priceRows: PriceRow[]
  otherVariations: VariationGroup[]
}
export const blankPricing: PricingFields = {
  price:'',retailPrice:'',boxPrice:'',unitsPerBox:'',pricingMode:'single',priceGroup:'',priceRows:[],otherVariations:[]
}
const presets: Record<string,string[]> = {
  'Tamanho':['P','M','G'], 'Comprimento':['40 cm','45 cm','50 cm'],
  'Embalagem':['Unidade','Pacote','Caixa fechada'], 'Modelo':['Modelo 1','Modelo 2'], 'Cor':['','']
}
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
function validPrice(raw: string) { return raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw)>=.01 && Number(raw)<=9999999999.99 }
function hasDuplicate(options: string[]) { return new Set(options.map(v=>v.toLocaleLowerCase('pt-BR'))).size!==options.length }
export function pricingFromProduct(product: AdminProduct): PricingFields {
  const groups = Array.isArray(product.variations) ? product.variations : []
  const config = product.variant_prices
  const group = config && groups.find(item=>item.name===config.group)
  return {
    price:String(product.price), retailPrice:product.retail_price==null?'':String(product.retail_price),
    boxPrice:product.box_price==null?'':String(product.box_price), unitsPerBox:product.units_per_box==null?'':String(product.units_per_box),
    pricingMode:group?'multiple':'single',priceGroup:group?.name||'',
    priceRows:group&&config?group.options.map(name=>({name,price:String(Object.hasOwn(config.prices,name)?config.prices[name]:product.price)})):[],
    otherVariations:groups.filter(item=>item!==group).map(item=>({name:item.name,options:[...item.options]})),
  }
}
export function buildPricingPayload(value: PricingFields): {price:number;variations:VariationGroup[];variantPrices:VariantPrices|null} {
  const groups: VariationGroup[] = []
  let variantPrices: VariantPrices|null = null
  let price = Number(value.price)
  if(value.pricingMode==='multiple'){
    const group=value.priceGroup.trim()
    const rows=value.priceRows.map(row=>({name:row.name.trim(),price:row.price}))
    if(!group || group.length>40) throw Error('Informe o nome do tipo de preço (ex.: Tamanho ou Embalagem).')
    if(rows.length<2 || rows.length>30) throw Error('Cadastre de 2 a 30 opções de preço ou escolha preço único.')
    if(rows.some(row=>!row.name || row.name.length>60 || !validPrice(row.price))) throw Error('Preencha o nome e o preço válido de cada opção.')
    const options=rows.map(row=>row.name)
    if(hasDuplicate(options)) throw Error('Não repita o nome de uma opção de preço.')
    groups.push({name:group,options})
    variantPrices={group,prices:Object.fromEntries(rows.map(row=>[row.name,Number(row.price)]))}
    // Keep existing base for catalog overrides; new multi-price products derive it.
    if(!validPrice(value.price)) price=Math.min(...rows.map(row=>Number(row.price)))
  }else if(!validPrice(value.price)){
    throw Error('Informe um preço do produto maior que zero.')
  }
  for(const item of value.otherVariations){
    const name=item.name.trim(),options=item.options.map(option=>option.trim()).filter(Boolean)
    if(!name&&!options.length)continue
    if(!name||name.length>40||!options.length||options.length>30||options.some(option=>option.length>60)||hasDuplicate(options))throw Error('Confira os nomes e as opções das demais variações do produto.')
    groups.push({name,options})
  }
  if(groups.length>5||hasDuplicate(groups.map(group=>group.name)))throw Error('Use até cinco tipos de variação, sem nomes repetidos.')
  return {price,variations:groups,variantPrices}
}

export default function ProductPriceEditor({value,onChange}:{value:PricingFields;onChange:(patch:Partial<PricingFields>)=>void}){
  const [advanced,setAdvanced]=useState(true)
  const [custom,setCustom]=useState(Boolean(value.priceGroup&&!Object.hasOwn(presets,value.priceGroup)))
  const [otherOpen,setOtherOpen]=useState(value.otherVariations.length>0)
  const multiple=value.pricingMode==='multiple'
  const catalogOverride=Boolean(value.catalogId&&Number(value.catalogPrice)!==Number(value.price))
  const validRows=value.priceRows.filter(row=>validPrice(row.price))
  const basePrice=validPrice(value.price)?Number(value.price):validRows.length?Math.min(...validRows.map(row=>Number(row.price))):0
  const factor=catalogOverride&&basePrice>0&&Number(value.catalogPrice)>0?Number(value.catalogPrice)/basePrice:1
  const changeMode=async(mode:PricingFields['pricingMode'])=>{
    if(mode===value.pricingMode)return
    if(mode==='multiple'){
      setCustom(false); onChange({pricingMode:mode,priceGroup:'',priceRows:[]});return
    }
    if(validRows.length&&!(await confirmAction('As opções continuarão disponíveis ao comprador, mas todas terão o mesmo preço.','Usar preço único','Continuar')))return
    const options=value.priceRows.map(row=>row.name.trim()).filter(Boolean)
    if(value.priceGroup.trim()&&options.length)setOtherOpen(true)
    onChange({pricingMode:mode,price:basePrice?String(basePrice):'',priceGroup:'',priceRows:[],
      otherVariations:value.priceGroup.trim()&&options.length?[...value.otherVariations,{name:value.priceGroup.trim(),options}]:value.otherVariations})
  }
  const changeGroup=async(selected:string)=>{
    if(selected===value.priceGroup&&!custom)return
    if(validRows.length&&!(await confirmAction('As opções e os preços desta tabela serão substituídos.','Alterar tipo de preço','Alterar')))return
    const former=value.otherVariations.find(group=>'existing:'+group.name===selected||group.name.toLocaleLowerCase('pt-BR')===selected.toLocaleLowerCase('pt-BR'))
    const name=former?.name||(selected==='custom'?'':selected)
    setCustom(selected==='custom'||Boolean(former&&!Object.hasOwn(presets,former.name)))
    onChange({priceGroup:name,priceRows:(former?.options||presets[name]||['','']).map(name=>({name,price:''})),
      otherVariations:former?value.otherVariations.filter(group=>group!==former):value.otherVariations})
  }
  const editRow=(index:number,patch:Partial<PriceRow>)=>onChange({priceRows:value.priceRows.map((row,i)=>i===index?{...row,...patch}:row)})
  const editGroup=(index:number,patch:Partial<VariationGroup>)=>onChange({otherVariations:value.otherVariations.map((group,i)=>i===index?{...group,...patch}:group)})
  const moneyInput=(label:string,raw:string,onValue:(raw:string)=>void,required=false)=><label><span>{label}</span><div className="svx-price-input"><span aria-hidden="true">R$</span><input aria-label={label} type="number" inputMode="decimal" min=".01" max="9999999999.99" step=".01" value={raw} onChange={e=>onValue(e.target.value)} placeholder="0,00" required={required}/></div></label>
  return <section className="product-inline-section svx-price-editor" aria-label="Preços do produto">
    <div className="svx-price-heading"><h3>Preços do produto</h3><p>Como você vende este produto?</p></div>
    <div className="svx-price-modes" role="group" aria-label="Tipo de preço">
      <button type="button" aria-pressed={!multiple} onClick={()=>void changeMode('single')}><strong>Preço único</strong><small>O mesmo valor para todas as opções.</small></button>
      <button type="button" aria-pressed={multiple} onClick={()=>void changeMode('multiple')}><strong>Vários preços</strong><small>Um valor para cada tamanho, embalagem ou opção.</small></button>
    </div>
    {!multiple?<div className="form-grid svx-price-fields">
      {moneyInput(value.catalogId?'Preço base (R$)':'Preço do produto (R$)',value.price,raw=>onChange({price:raw}),true)}
      <p className="svx-price-hint span-2">Preço base utilizado no Geral, Atacado e Alto Atacado. Varejo e caixa fechada podem ter valores próprios abaixo.</p>
      {value.catalogId&&catalogOverride&&<p className="svx-price-hint span-2">Este catálogo tem um preço próprio. Os demais preços do produto são mantidos.</p>}
    </div>:<div className="svx-price-multiple">
      <label><span>O que muda o preço?</span><select aria-label="O que muda o preço?" value={custom?'custom':value.priceGroup} onChange={e=>void changeGroup(e.target.value)}><option value="" disabled>Escolha uma opção</option>{Object.keys(presets).map(name=><option key={name} value={name}>{name==='Embalagem'?'Embalagem (unidade, pacote, caixa)':name}</option>)}
        {value.otherVariations.filter(group=>group.name.trim()&&!Object.keys(presets).some(name=>name.toLocaleLowerCase('pt-BR')===group.name.toLocaleLowerCase('pt-BR'))).map((group,i)=><option key={i} value={'existing:'+group.name}>Usar {group.name} já cadastrado</option>)}<option value="custom">Outro (personalizado)</option></select></label>
      {custom&&<label><span>Nome do tipo de preço</span><input value={value.priceGroup} maxLength={40} placeholder="Ex.: Material" onChange={e=>onChange({priceGroup:e.target.value})} required/></label>}
      {(value.priceGroup||custom)&&<>
        <div className="svx-price-row-head"><span>{value.priceGroup==='Embalagem'?'Forma de venda':'Nome da opção'}</span><span>{factor!==1?'Preço padrão (R$)':'Preço (R$)'}</span><span/></div>
        {value.priceRows.map((row,i)=><div className="svx-price-row" key={i}>
          <input aria-label={'Nome da opção '+(i+1)} value={row.name} maxLength={60} placeholder={value.priceGroup==='Embalagem'?'Ex.: Pacote com 6 un.':'Ex.: Opção '+(i+1)} onChange={e=>editRow(i,{name:e.target.value})} required/>
          <div className="svx-price-input"><span aria-hidden="true">R$</span><input aria-label={'Preço da opção '+(i+1)} inputMode="decimal" type="number" min=".01" max="9999999999.99" step=".01" placeholder="0,00" value={row.price} required onChange={e=>editRow(i,{price:e.target.value})}/></div>
          <button type="button" className="svx-price-remove" aria-label={'Remover opção '+(i+1)} disabled={value.priceRows.length<=2} onClick={()=>onChange({priceRows:value.priceRows.filter((_,index)=>index!==i)})}><Trash2 size={17}/></button>
          {factor!==1&&validPrice(row.price)&&<small className="svx-price-catalog-preview">Neste catálogo: {currency.format(Math.round(Number(row.price)*factor*100)/100)}</small>}
        </div>)}
        <button type="button" className="secondary-action svx-price-add" disabled={value.priceRows.length>=30} onClick={()=>onChange({priceRows:[...value.priceRows,{name:'',price:''}]})}><Plus size={16}/> Adicionar opção</button>
        {value.priceGroup==='Embalagem'&&<p className="svx-price-hint">Informe o valor da embalagem inteira. Você pode indicar a quantidade no nome, por exemplo: Pacote com 6 unidades.</p>}
        <div className="svx-price-preview"><small>Como aparece para o comprador</small><strong>{validRows.length?((validRows.length>1&&Math.min(...validRows.map(row=>Number(row.price)))!==Math.max(...validRows.map(row=>Number(row.price))))?'A partir de ':'')+currency.format(Math.round(Math.min(...validRows.map(row=>Number(row.price)))*factor*100)/100):'Preencha os preços acima'}</strong></div>
      </>}
    </div>}
    <details className="svx-pricing-details" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}><summary>Preços de outros catálogos e condições adicionais</summary><div className="form-grid svx-price-fields">
      {multiple&&moneyInput('Preço base (R$)',value.price,raw=>onChange({price:raw}))}
      {value.catalogId&&<div className="span-2">{moneyInput('Preço exibido neste catálogo (R$)',value.catalogPrice??value.price,raw=>onChange({catalogPrice:raw}))}<p className="svx-price-hint">Exceção opcional: altere este campo somente para definir um preço específico. Para voltar ao preço automático, use a opção na lista de catálogos.</p></div>}
      {multiple&&<p className="svx-price-hint span-2">Os valores das opções são preços padrão. Se um catálogo tiver outro preço base, suas opções mantêm a mesma proporção. Para produtos novos, o menor preço é usado como base.</p>}
      {moneyInput('Preço varejo (R$)',value.retailPrice,raw=>onChange({retailPrice:raw}))}
      {moneyInput('Preço caixa fechada (R$)',value.boxPrice,raw=>onChange({boxPrice:raw}))}
      <label><span>Unidades por caixa</span><input type="number" min="1" max="10000" step="1" value={value.unitsPerBox} onChange={e=>onChange({unitsPerBox:e.target.value})} placeholder="Ex.: 12"/></label>
      <p className="svx-price-hint span-2">Use estes campos somente para preços de catálogos separados. Para vender unidade, pacote e caixa no mesmo catálogo, use Vários preços → Embalagem.</p>
    </div></details>
    <details className="svx-pricing-details" open={otherOpen} onToggle={e=>setOtherOpen(e.currentTarget.open)}><summary>Outras opções do produto (sem alterar o preço)</summary><p className="svx-price-hint">Ex.: cores disponíveis com o mesmo valor. O comprador escolhe no momento do pedido.</p>
      {value.otherVariations.map((group,i)=><div className="svx-other-variation" key={i}><div className="svx-other-head"><label><span>Tipo de opção</span><input value={group.name} placeholder="Ex.: Cor" maxLength={40} onChange={e=>editGroup(i,{name:e.target.value})}/></label><button type="button" className="svx-price-remove" aria-label={'Remover grupo '+(i+1)} onClick={()=>onChange({otherVariations:value.otherVariations.filter((_,index)=>index!==i)})}><Trash2 size={17}/></button></div>
        {group.options.map((option,j)=><div className="svx-other-option" key={j}><input aria-label={'Opção '+(i+1)+'.'+(j+1)} value={option} maxLength={60} placeholder="Ex.: Preto" onChange={e=>editGroup(i,{options:group.options.map((raw,k)=>k===j?e.target.value:raw)})}/><button type="button" className="svx-price-remove" aria-label={'Remover opção adicional '+(i+1)+'.'+(j+1)} onClick={()=>editGroup(i,{options:group.options.filter((_,k)=>k!==j)})}><Trash2 size={15}/></button></div>)}
        <button type="button" className="secondary-action" disabled={group.options.length>=30} onClick={()=>editGroup(i,{options:[...group.options,'']})}><Plus size={15}/> Adicionar valor</button>
      </div>)}
      <button type="button" className="secondary-action" disabled={value.otherVariations.length>=(multiple?4:5)} onClick={()=>onChange({otherVariations:[...value.otherVariations,{name:'',options:['']}]})}><Plus size={15}/> Adicionar tipo de opção</button>
    </details>
  </section>
}
