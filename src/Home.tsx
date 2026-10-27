import { useEffect, useState } from 'react'
import { ArrowRight, Check, Grid2X2, ShoppingBag, Smartphone } from 'lucide-react'
import { apiRequest } from './api'
import UiState from './UiState'
import { SVRibbon, SVStamp } from './ShopvaxDesignSystem'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

type HomePlan = { code: string; name: string; monthlyPrice: number; sellerLimit: number | null; catalogLimit: number | null; photoLimit: number | null; franchiseeLimit: number | null }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function planCopy(plan: HomePlan) {
  const sellers = plan.sellerLimit == null ? 'Vendedoras ilimitadas' : `${plan.sellerLimit} vendedoras`
  const catalogs = plan.catalogLimit == null ? 'Catálogos ilimitados' : `${plan.catalogLimit} ${plan.catalogLimit === 1 ? 'catálogo' : 'catálogos'}`
  const photos = plan.photoLimit == null ? 'Fotos ilimitadas' : `${plan.photoLimit} fotos por produto`
  const franchisees = plan.franchiseeLimit == null ? 'Franqueados ilimitados' : plan.franchiseeLimit === 0 ? 'Sem franqueados' : `${plan.franchiseeLimit} franqueados`
  return [sellers, catalogs, photos, franchisees]
}

export default function Home() {
  const [plans, setPlans] = useState<HomePlan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansError, setPlansError] = useState('')
  const loadPlans = async () => {
    setPlansLoading(true); setPlansError('')
    try { const result = await apiRequest<{ plans: HomePlan[] }>('/api/public/plans'); setPlans(result.plans || []) }
    catch (err) { setPlansError(err instanceof Error ? err.message : 'Não foi possível carregar os planos.') }
    finally { setPlansLoading(false) }
  }
  useEffect(() => { void loadPlans() }, [])

  return (
    <div className="home-shell">
      <header className="home-nav">
        <button className="wordmark"><span>SV</span> Shopvax</button>
        <div><button className="text-button" onClick={() => go('/entrar')}>Entrar</button><button className="nav-cta" onClick={() => go('/criar-conta')}>Criar loja</button></div>
      </header>
      <main className="home-main">
        <section className="home-hero svx-home-hero">
          <SVRibbon className="svx-home-hero__ribbon"><span>SHOPVAX · O ATACADO FEITO PRA VENDER</span><span>CATÁLOGO → GRADE → WHATSAPP</span></SVRibbon>
          <div className="svx-home-hero__grid"><div className="svx-home-hero__message">
            <p className="eyebrow">Para quem vende no atacado</p>
            <h1>O talão de pedido,<br/>no celular.</h1>
            <p className="home-hero__lead">A vitrine é da sua loja. Seu cliente escolhe cores e tamanhos, monta a grade e leva um talão pronto para conversar com a vendedora pelo WhatsApp.</p>
            <div className="home-hero__actions"><button className="primary-action" onClick={() => document.getElementById('planos')?.scrollIntoView({ behavior:'smooth' })}>Conhecer planos <ArrowRight size={18}/></button><a href="/casa-norte/marina">Ver uma loja de exemplo</a></div>
            <p className="home-trustline"><strong>Seu catálogo, sua marca.</strong> Link individual por vendedora, preço à vista, pedido mínimo e atendimento direto.</p>
          </div>
          <aside className="svx-home-ticket" aria-label="Exemplo ilustrativo de um talão de pedido"><span className="svx-kicker">O NOVO JEITO DE ANOTAR O PEDIDO</span><SVStamp>NA GRADE</SVStamp><div className="svx-home-ticket__header"><strong>TALÃO DIGITAL</strong><span>EXEMPLO VISUAL</span></div><div className="svx-home-ticket__steps"><div><b>01</b><span>ESCOLHA AS PEÇAS</span><strong>Catálogo e feed</strong></div><div><b>02</b><span>MONTE A GRADE</span><strong>Cor · tamanho · quantidade</strong></div><div><b>03</b><span>CONFIRA O PEDIDO</span><strong>Talão e pedido mínimo</strong></div><div><b>04</b><span>FALE COM A VENDEDORA</span><strong>WhatsApp do atendimento</strong></div></div><div className="svx-home-ticket__tear" aria-hidden="true"/><p>FEITO COM SHOPVAX ✳</p></aside></div>
        </section>
        <section className="home-strip">
          <div><Grid2X2 size={21} /><strong>Loja</strong><span>Catálogo direto e pesquisável.</span></div>
          <div><Smartphone size={21} /><strong>Feed</strong><span>Produto em tela cheia para rolar.</span></div>
          <div><ShoppingBag size={21} /><strong>Carrinho</strong><span>Quantidade, variação e pedido mínimo.</span></div>
          <div><ArrowRight size={21} /><strong>WhatsApp</strong><span>Cada link entrega para a vendedora certa.</span></div>
        </section>
        <section className="home-pricing" id="planos">
          <div className="home-pricing__head"><div><p className="eyebrow">O PLANO CERTO PARA O SEU BALCÃO</p><h2>Bronze, Prata ou Ouro.</h2><p>Comece com a operação que você tem e cresça sem trocar a identidade da loja. Valores e limites vêm das regras oficiais do Shopvax.</p></div></div>
          {plansLoading ? <UiState loading title="Carregando planos…" compact/> : plansError ? <UiState title="Não foi possível carregar os planos." message={plansError} onRetry={() => void loadPlans()} compact/> : <div className="home-pricing__grid">{plans.map((plan) => <article key={plan.code} className={plan.code === 'prata' ? 'is-featured' : ''}><header><span>{plan.name}</span><strong>{money.format(plan.monthlyPrice)}<small>/mês</small></strong></header><ul>{planCopy(plan).map((item) => <li key={item}><Check size={15}/>{item}</li>)}</ul><button className={plan.code === 'prata' ? 'primary-action' : 'secondary-action'} onClick={() => go(`/criar-conta?plan=${encodeURIComponent(plan.code)}`)}>Escolher {plan.name}<ArrowRight size={16}/></button></article>)}</div>}
          <p className="home-pricing__note">O ciclo exibido aqui é mensal. Descontos semestrais e anuais ficam na configuração comercial e só devem aparecer ao lojista quando estiverem disponíveis para contratação.</p>
        </section>
      </main>
    </div>
  )
}
