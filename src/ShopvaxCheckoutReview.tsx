import { useState } from 'react'
import { ArrowRight, Check, MessageCircle, X } from 'lucide-react'
import type { CartItem } from './types'
import { SVRibbon } from './ShopvaxDesignSystem'

const currency = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })
export type CheckoutBuyer = { name:string; city:string; cep:string; phone:string }
type Props = {
  items:CartItem[]
  total:number
  minimum:number
  storeName:string
  sellerName:string
  sending:boolean
  error:string
  onClose:()=>void
  onSubmit:(buyer:CheckoutBuyer,notes:string)=>Promise<void>
}

export default function ShopvaxCheckoutReview({items,total,minimum,storeName,sellerName,sending,error,onClose,onSubmit}: Props){
  const [buyer,setBuyer]=useState<CheckoutBuyer>({name:'',city:'',cep:'',phone:''})
  const [notes,setNotes]=useState('')
  const [showBuyer,setShowBuyer]=useState(false)
  const update=(key:keyof CheckoutBuyer,value:string)=>setBuyer(current=>({...current,[key]:value}))
  const validCep=!buyer.cep||buyer.cep.replace(/\D/g,'').length===8
  const validPhone=!buyer.phone||buyer.phone.replace(/\D/g,'').length>=10
  const canSend=items.length>0&&total>=minimum&&!sending&&validCep&&validPhone
  return <div className="svx-review-layer" role="dialog" aria-modal="true" aria-labelledby="svx-review-title">
    <button type="button" className="svx-review-layer__backdrop" onClick={onClose} aria-label="Fechar revisão"/>
    <section className="svx-review">
      <SVRibbon><span>SHOPVAX · TALÃO DIGITAL</span><span>REVISE ANTES DE ENVIAR</span></SVRibbon>
      <header className="svx-review__head"><div><span className="svx-kicker">PEDIDO QUASE PRONTO</span><h2 id="svx-review-title">Confira seu talão.</h2><p>Revise as peças e abra o WhatsApp de {sellerName} para conversar sobre o pedido.</p></div><button type="button" onClick={onClose} aria-label="Fechar revisão"><X size={20}/></button></header>
      <div className="svx-review__scroll">
        <div className="svx-review__meta"><span>LOJA <strong>{storeName}</strong></span><span>ATENDIMENTO <strong>{sellerName}</strong></span></div>
        <div className="svx-review__items">{items.map((item,index)=><div className="svx-review__item" key={item.key}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{item.product.name}</strong><small>REF. {item.product.sku||'—'}</small><p>{Object.entries(item.selections).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p><small>{item.quantity} × {currency.format(item.product.price)}</small></div><strong>{currency.format(item.product.price*item.quantity)}</strong></div>)}</div>
        <div className="svx-review__total"><span>TOTAL DAS PEÇAS</span><strong>{currency.format(total)}</strong></div>
        <button type="button" className="svx-review__buyer-toggle" aria-expanded={showBuyer} onClick={()=>setShowBuyer(!showBuyer)}>{showBuyer?'Ocultar dados do comprador':'Adicionar dados do comprador (opcional)'}<ArrowRight size={17}/></button>
        {showBuyer&&<div className="svx-review__buyer-fields"><label>Nome<input value={buyer.name} maxLength={120} autoComplete="name" placeholder="Seu nome" onChange={e=>update('name',e.target.value)}/></label><label>WhatsApp<input value={buyer.phone} type="tel" maxLength={20} autoComplete="tel" placeholder="DDD + número" onChange={e=>update('phone',e.target.value)}/></label><label>Cidade<input value={buyer.city} maxLength={100} autoComplete="address-level2" placeholder="Sua cidade" onChange={e=>update('city',e.target.value)}/></label><label>CEP<input value={buyer.cep} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" onChange={e=>update('cep',e.target.value)}/></label>{!validCep&&<small role="alert">Informe um CEP válido de 8 dígitos.</small>}{!validPhone&&<small role="alert">Informe um telefone válido ou deixe em branco.</small>}</div>}
        <label className="svx-review__notes">Observações para a vendedora<textarea rows={3} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ex.: separar outras cores, retirada na loja..."/></label>
        <p className="svx-review__privacy">Os dados informados serão incluídos no pedido da loja e na mensagem preparada para o WhatsApp. Eles não criam cadastro para receber publicidade.</p>
        {error&&<p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="svx-review__footer"><span><Check size={15}/> {items.reduce((count,item)=>count+item.quantity,0)} peças conferidas</span><button disabled={!canSend} type="button" onClick={()=>void onSubmit(buyer,notes)}><MessageCircle size={19}/>{sending?'Preparando talão…':'Abrir pedido no WhatsApp'}<ArrowRight size={18}/></button><small>Abrir o WhatsApp não comprova que a mensagem foi enviada ou que a venda foi concluída.</small></footer>
    </section>
  </div>
}
