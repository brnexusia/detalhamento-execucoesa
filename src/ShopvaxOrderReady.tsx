import { useState } from 'react'
import { ArrowRight, Check, Clipboard, MessageCircle, X } from 'lucide-react'
import { SVRibbon, SVStamp } from './ShopvaxDesignSystem'
import './shopvax-order-ready.css'

type Props={storeName:string;code:string;url:string;onClose:()=>void}
export default function ShopvaxOrderReady({storeName,code,url,onClose}:Props){
  const [copied,setCopied]=useState(false)
  const [opening,setOpening]=useState(false)
  const [error,setError]=useState('')
  const text=(()=>{try{return new URL(url).searchParams.get('text') || url}catch{return url}})()
  const copy=async()=>{
    try{await navigator.clipboard.writeText(text);setCopied(true);setError('')}
    catch{setError('Não foi possível copiar automaticamente. Selecione a mensagem abaixo para copiar.')}
  }
  return <div className="svx-review-layer" role="dialog" aria-modal="true" aria-labelledby="svx-ready-title">
    <button type="button" className="svx-review-layer__backdrop" onClick={onClose} aria-label="Fechar confirmação"/>
    <section className={`svx-order-ready ${opening ? 'is-tearing' : ''}`}>
      <SVRibbon><span>SHOPVAX · TALÃO DIGITAL</span><span>PRONTO PARA ENVIAR</span></SVRibbon>
      <header><button onClick={onClose} aria-label="Fechar confirmação"><X size={19}/></button><SVStamp>PEDIDO PRONTO</SVStamp><span className="svx-kicker">{code}</span><h2 id="svx-ready-title">Agora é só enviar.</h2><p>O pedido foi preparado na {storeName}. Ao tocar em mandar, a conversa será aberta no WhatsApp. Confira e envie a mensagem para a vendedora.</p></header>
      <div className="svx-order-ready__message"><span className="svx-kicker">MENSAGEM QUE VAI SER ENVIADA</span><textarea aria-label="Mensagem preparada para o WhatsApp" readOnly rows={10} value={text} onFocus={e=>e.currentTarget.select()}/></div>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <footer><a href={url} target="_blank" rel="noopener noreferrer" className="svx-order-ready__send" onClick={()=>setOpening(true)}><MessageCircle size={17}/> Abrir WhatsApp e mandar <ArrowRight size={18}/></a><button type="button" onClick={()=>void copy()} className="svx-order-ready__copy">{copied?<Check size={17}/>:<Clipboard size={17}/>} {copied?'Mensagem copiada':'Copiar pedido'}</button><small>Preparar o talão não confirma entrega da mensagem, pagamento ou venda concluída.</small></footer>
    </section>
  </div>
}
