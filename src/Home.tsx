import { useEffect, useState } from 'react'
import { ArrowRight, Grid2X2, ShoppingBag, Smartphone } from 'lucide-react'
import { apiRequest } from './api'
import UiState from './UiState'
import ShopvaxPlans from './ShopvaxPlans'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

type HomePlan = { code: string; name: string; monthlyPrice: number; sellerLimit: number | null; catalogLimit: number | null; photoLimit: number | null; franchiseeLimit: number | null }

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
          {plansLoading ? <UiState loading title="Carregando planos…" compact/> : plansError ? <UiState title="Não foi possível carregar os planos." message={plansError} onRetry={() => void loadPlans()} compact/> : <ShopvaxPlans plans={plans} onChoose={(code) => go(`/criar-conta?plan=${encodeURIComponent(code)}`)}/>}
          <p className="home-pricing__note">O ciclo exibido aqui é mensal. Descontos semestrais e anuais ficam na configuração comercial e só devem aparecer ao lojista quando estiverem disponíveis para contratação.</p>
        </section>
      </main>
    </div>
  )
}
