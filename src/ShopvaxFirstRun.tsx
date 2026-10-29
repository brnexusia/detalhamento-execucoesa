import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { SHOPVAX_PALETTES } from './ShopvaxDesignSystem'

type Props={storeName:string;initialAccent:string;onSave:(accent:string)=>Promise<void>;onSkip:()=>void}
export default function ShopvaxFirstRun({storeName,initialAccent,onSave,onSkip}:Props){
  const [accent,setAccent]=useState(initialAccent)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const save=async()=>{
    if(busy)return
    setBusy(true);setError('')
    try{await onSave(accent)}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar a cor.')}
    finally{setBusy(false)}
  }
  return <section className="svx-onboarding" aria-labelledby="svx-onboarding-title">
    <header className="svx-onboarding__top"><strong><img src="/brand/shopvax-wordmark.svg" className="svx-brand-wordmark" alt="Shopvax" /></strong><span>01 — COR DA LOJA</span><button type="button" onClick={onSkip}>Pular agora</button></header>
    <div className="svx-onboarding__intro"><div><span className="svx-kicker">CONFIGURAÇÃO INICIAL · COR DA LOJA</span><h1 id="svx-onboarding-title">Qual a cor da sua loja?</h1></div><p>O catálogo é o mesmo nas três opções. Muda a cor dos botões e da barra do pedido. Dá pra trocar depois em Minha loja.</p></div>
    <div className="svx-onboarding__choices" role="group" aria-label="Escolha a identidade da loja">{SHOPVAX_PALETTES.map(palette=><button type="button" key={palette.id} className={`svx-onboarding__card ${accent.toLowerCase()===palette.accent.toLowerCase()?'is-active':''}`} onClick={()=>setAccent(palette.accent)} aria-pressed={accent.toLowerCase()===palette.accent.toLowerCase()}>
      <div className="svx-onboarding__preview" style={{'--sample-accent':palette.accent} as React.CSSProperties}><div className="svx-onboarding__phone"><div className="svx-onboarding__phone-head"><span>{storeName}</span><span>◎</span></div><div className="svx-onboarding__phone-band">PEDIDO MÍNIMO · SELECIONE SUAS PEÇAS</div><strong>COLEÇÃO ATUAL</strong><div className="svx-onboarding__photo"/><div className="svx-onboarding__phone-bottom"><span>EXEMPLO</span><span>VER PEDIDO →</span></div></div></div>
      <div className="svx-onboarding__card-copy"><strong>{palette.label.toUpperCase()}</strong>{accent.toLowerCase()===palette.accent.toLowerCase()&&<Check size={19}/>}<small>{palette.id==='laranja'?'A cor da Shopvax. Vai bem com qualquer produto.':palette.id==='mostarda'?'Amarelo quente. Chama atenção sem gritar.':'Cinza escuro e discreto. Deixa a foto aparecer mais.'}</small><span className="svx-onboarding__swatches"><i style={{backgroundColor:palette.accent}}/><i style={{backgroundColor:'#161514'}}/><i style={{backgroundColor:'#F3F0E8'}}/></span></div>
    </button>)}</div>
    <footer className="svx-onboarding__footer"><span>Ou use sua cor em <button type="button" onClick={onSkip}>Minha loja</button>.</span>{error&&<p role="alert" className="form-error">{error}</p>}<button type="button" className="svx-onboarding__continue" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':'Continuar com a cor'} <ArrowRight size={17}/></button></footer>
  </section>
}
