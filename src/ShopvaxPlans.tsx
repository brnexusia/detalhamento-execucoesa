import { ArrowRight, Check, CircleHelp } from 'lucide-react'
import { SVStamp } from './ShopvaxDesignSystem'

export type PlanView = {
  code:string
  name:string
  monthlyPrice:number
  sellerLimit:number|null
  catalogLimit:number|null
  photoLimit:number|null
  franchiseeLimit:number|null
  productLimit?:number|null
}
const rows=[
  { label:'Vendedoras',key:'sellerLimit' as const },
  { label:'Catálogos',key:'catalogLimit' as const },
  { label:'Fotos por produto',key:'photoLimit' as const },
  { label:'Franqueados',key:'franchiseeLimit' as const },
  { label:'Produtos',key:'productLimit' as const },
]
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
function number(value:number|null|undefined){return value==null?'Ilimitados':new Intl.NumberFormat('pt-BR').format(value)}
const info:Record<string,string>={
  bronze:'Pra quem está começando a vender pelo link.',
  prata:'Pra loja com equipe e mais de um catálogo.',
  ouro:'Pra rede com franqueados e catálogo sem limite.',
}
type Props={plans:PlanView[];onChoose:(code:string)=>void}
export default function ShopvaxPlans({plans,onChoose}:Props){
  const sorted=[...plans].sort((a,b)=>['bronze','prata','ouro'].indexOf(a.code)-['bronze','prata','ouro'].indexOf(b.code))
  return <div className="svx-plans">
    <div className="svx-plans__intro"><div><span className="svx-kicker">PLANOS PRA QUEM VENDE</span><h2>Escolha o tamanho da sua empresa ou loja</h2><SVStamp className="svx-plans__stamp">SEU PRÓXIMO PASSO</SVStamp></div><p>Todos os planos têm catálogo, pedidos por WhatsApp e produtos conforme os limites do plano. Mude de tamanho conforme a sua operação.</p></div>
    <div className="svx-plans__comparison" role="region" aria-label="Comparação dos planos Shopvax" tabIndex={0}>
      <table>
        <thead><tr><th scope="col" className="svx-plans__reference"><span className="svx-kicker">PLANOS</span><p>Compare equipe, catálogos e recursos disponíveis em cada plano.</p></th>{sorted.map(plan=><th scope="col" key={plan.code} className={plan.code==='prata'?'svx-plans__recommended':''}>{plan.code==='prata'&&<span className="svx-plans__flag">RECOMENDADO</span>}<h3>{plan.name}</h3><p>{info[plan.code]||'Catálogo para o seu negócio.'}</p><strong>{money.format(plan.monthlyPrice)}</strong><small>POR MÊS</small></th>)}</tr></thead>
        <tbody>{rows.map(row=><tr key={row.key}><th scope="row">{row.label}</th>{sorted.map(plan=><td key={plan.code} className={plan.code==='prata'?'svx-plans__recommended':''}>{number(plan[row.key])}</td>)}</tr>)}</tbody>
        <tfoot><tr><td>Escolha seu plano</td>{sorted.map(plan=><td key={plan.code} className={plan.code==='prata'?'svx-plans__recommended':''}><button type="button" aria-label={`Começar no ${plan.name}`} className={plan.code==='prata'?'svx-plans__cta is-featured':'svx-plans__cta'} onClick={()=>onChoose(plan.code)}><span className="svx-plans__cta-prefix">Começar no </span>{plan.name} <ArrowRight size={15}/></button></td>)}</tr></tfoot>
      </table>
    </div>
    <div className="svx-plans__benefits"><div><span className="svx-kicker">EM TODOS OS PLANOS</span><h3>O que muda é a sua operação!</h3><p>Recursos essenciais em todos os planos; capacidades adicionais conforme o plano escolhido.</p></div><div className="svx-plans__benefit-grid">{[
      ['Catálogo com busca','Busca por nome e referência, filtro por categoria.'],
      ['Feed em tela cheia','O cliente vê produto por produto, em tela cheia.'],
      ['Carrinho com grade','Quantidade por tamanho e aviso do quanto falta pro mínimo.'],
      ['Link por vendedora','Cada vendedora recebe os pedidos do próprio link.'],
      ['Catálogo em PDF','Gere o catálogo pra quem não abre link.'],
      ['Pedidos no painel','Pedido numerado e registrado, com quem atendeu.'],
    ].map(([title,desc])=><div key={title}><Check size={14}/><span><strong>{title}</strong><small>{desc}</small></span></div>)}</div></div>
    <div className="svx-plans__help"><div><h3>Ficou em dúvida entre os planos?</h3><p>Compare o tamanho da sua loja e escolha o que faz sentido para sua equipe.</p></div><button onClick={()=>document.getElementById('planos')?.scrollIntoView({behavior:'smooth'})}><CircleHelp size={16}/> Comparar planos</button></div>
  </div>
}
