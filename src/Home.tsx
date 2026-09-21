import { useEffect, useState } from 'react'
import { ArrowRight, Check, Grid2X2, ShoppingBag, Smartphone } from 'lucide-react'
import { apiRequest } from './api'

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
  return [sellers, catalogs, photos]
}

export default function Home() {
  const [plans, setPlans] = useState<HomePlan[]>([])
  useEffect(() => {
    apiRequest<{ plans: HomePlan[] }>('/api/public/plans').then((result) => setPlans(result.plans || [])).catch(() => undefined)
  }, [])

  return (
    <div className="home-shell">
      <header className="home-nav">
        <button className="wordmark"><span>SV</span> Shopvax</button>
        <div><button className="text-button" onClick={() => go('/entrar')}>Entrar</button><button className="nav-cta" onClick={() => go('/criar-conta')}>Criar loja</button></div>
      </header>
      <main className="home-main">
        <section className="home-hero">
          <p className="eyebrow">Catálogo para atacado</p>
          <h1>O cliente escolhe.<br />Sua vendedora fecha.</h1>
          <p className="home-hero__lead">Uma loja simples para mostrar produto, deixar o cliente montar o carrinho e mandar tudo pronto para o WhatsApp certo.</p>
          <div className="home-hero__actions"><button className="primary-action" onClick={() => document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth' })}>Ver planos <ArrowRight size={18} /></button><a href="/casa-norte/marina">Ver loja demo</a></div>
          <p className="home-trustline"><strong>Sem checkout obrigatório.</strong> Link por vendedora, carrinho com quantidade e variações e pedido enviado direto para o WhatsApp.</p>
        </section>
        <section className="home-strip">
          <div><Grid2X2 size={21} /><strong>Loja</strong><span>Catálogo direto e pesquisável.</span></div>
          <div><Smartphone size={21} /><strong>Feed</strong><span>Produto em tela cheia para rolar.</span></div>
          <div><ShoppingBag size={21} /><strong>Carrinho</strong><span>Quantidade, variação e pedido mínimo.</span></div>
          <div><ArrowRight size={21} /><strong>WhatsApp</strong><span>Cada link entrega para a vendedora certa.</span></div>
        </section>
        <section className="home-pricing" id="planos">
          <div className="home-pricing__head"><div><p className="eyebrow">Planos</p><h2>Bronze, Prata ou Ouro.</h2><p>Escolha pelo tamanho da operação. O cadastro mostra o valor mensal e aplica o plano já na criação da loja.</p></div></div>
          {plans.length ? <div className="home-pricing__grid">{plans.map((plan) => <article key={plan.code} className={plan.code === 'prata' ? 'is-featured' : ''}><header><span>{plan.name}</span><strong>{money.format(plan.monthlyPrice)}<small>/mês</small></strong></header><ul>{planCopy(plan).map((item) => <li key={item}><Check size={15}/>{item}</li>)}</ul><button className={plan.code === 'prata' ? 'primary-action' : 'secondary-action'} onClick={() => go(`/criar-conta?plan=${encodeURIComponent(plan.code)}`)}>Escolher {plan.name}<ArrowRight size={16}/></button></article>)}</div> : <div className="home-pricing__loading">Carregando planos…</div>}
          <p className="home-pricing__note">O ciclo exibido aqui é mensal. Descontos semestrais e anuais ficam na configuração comercial e só devem aparecer ao lojista quando estiverem disponíveis para contratação.</p>
        </section>
      </main>
    </div>
  )
}
