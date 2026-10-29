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
    setPlansLoading(true)
    setPlansError('')
    try {
      const result = await apiRequest<{ plans: HomePlan[] }>('/api/public/plans')
      setPlans(result.plans || [])
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Não foi possível carregar os planos.')
    } finally {
      setPlansLoading(false)
    }
  }
  useEffect(() => { void loadPlans() }, [])

  return (
    <div className="home-shell">
      <a className="svx-home-skip-link" href="#conteudo">Pular para o conteúdo</a>
      <header className="home-nav">
        <a className="wordmark" href="/para-lojas" aria-label="Shopvax — para lojistas">
          <img src="/brand/shopvax-symbol.svg" className="svx-brand-symbol" alt="" aria-hidden="true" /><img src="/brand/shopvax-wordmark.svg" className="svx-brand-wordmark" alt="" aria-hidden="true" />
        </a>
        <nav aria-label="Acesso à plataforma">
          <button type="button" className="text-button" onClick={() => go('/entrar')}>Entrar</button>
          <button type="button" className="nav-cta" onClick={() => go('/criar-conta')}>Criar loja</button>
        </nav>
      </header>

      <main className="home-main" id="conteudo">
        <section className="svx-home-hero" aria-labelledby="svx-home-title">
          <div className="svx-ribbon svx-home-hero__ribbon">
            <span>CATÁLOGO DE ATACADO</span>
            <span>CATÁLOGO → GRADE → TALÃO → WHATSAPP</span>
          </div>

          <div className="svx-home-hero__grid">
            <div className="svx-home-hero__message">
              <p className="eyebrow">O ATACADO TEM SEU JEITO DE VENDER.</p>
              <h1 id="svx-home-title">O TALÃO DE PEDIDO, <em>NO CELULAR.</em></h1>
              <p className="home-hero__lead">
                O cliente escolhe. Sua vendedora fecha. Uma loja simples para mostrar produtos,
                montar grades e preparar o pedido para o WhatsApp certo.
              </p>
              <div className="home-hero__actions">
                <button type="button" className="primary-action" onClick={() => document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth' })}>
                  Ver planos <ArrowRight size={18} aria-hidden="true" />
                </button>
                <a href="/casa-norte/marina">Ver loja demo</a>
              </div>
              <p className="home-trustline"><strong>Sem checkout obrigatório.</strong> Pedido mínimo, variações e link individual por vendedora — o atendimento continua no WhatsApp.</p>
            </div>

            <div className="svx-home-ticket" aria-label="Ilustração do fluxo de compra no atacado">
              <span className="svx-kicker">COMO O PEDIDO ACONTECE · EXEMPLO ILUSTRATIVO</span>
              <div className="svx-home-ticket__header">
                <strong>SEU TALÃO.</strong>
                <span>DA VITRINE À VENDEDORA, SEM TROCAR DE LOJA.</span>
              </div>
              <div className="svx-home-ticket__steps">
                <div><b>01</b><span>CATÁLOGO</span><strong>Escolha suas peças</strong></div>
                <div><b>02</b><span>GRADE</span><strong>Defina cor, tamanho e quantidade</strong></div>
                <div><b>03</b><span>TALÃO</span><strong>Prepare o pedido para a vendedora</strong></div>
              </div>
              <div className="svx-home-ticket__tear" aria-hidden="true" />
              <p>FEITO PARA QUEM COMPRA E VENDE NO ATACADO.</p>
            </div>
          </div>
        </section>

        <section className="home-strip" aria-label="Como funciona o Shopvax">
          <div><Grid2X2 size={21} aria-hidden="true" /><strong>Loja</strong><span>Catálogo direto e pesquisável.</span></div>
          <div><Smartphone size={21} aria-hidden="true" /><strong>Feed</strong><span>Produto em tela cheia para rolar.</span></div>
          <div><ShoppingBag size={21} aria-hidden="true" /><strong>Talão</strong><span>Grade, quantidade e pedido mínimo.</span></div>
          <div><ArrowRight size={21} aria-hidden="true" /><strong>WhatsApp</strong><span>O pedido chega preparado à vendedora certa.</span></div>
        </section>

        <section className="home-pricing" id="planos" aria-label="Planos Shopvax">
          {plansLoading
            ? <UiState loading title="Carregando planos…" compact />
            : plansError
              ? <UiState title="Não foi possível carregar os planos." message={plansError} onRetry={() => void loadPlans()} compact />
              : <ShopvaxPlans plans={plans} onChoose={(code) => go('/criar-conta?plan=' + encodeURIComponent(code))} />}
          <p className="home-pricing__note">Os valores e limites exibidos vêm dos planos ativos da plataforma. Descontos de outros ciclos só aparecem quando disponíveis para contratação.</p>
        </section>
      </main>
      <footer className="svx-home-footer"><strong><img className="svx-brand-wordmark" src="/brand/shopvax-wordmark.svg" alt="Shopvax" /></strong><span>O talão de pedido, no celular.</span></footer>
    </div>
  )
}
