import { useEffect, useState } from 'react'
import { AlertCircle, ArrowUpRight, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
// Sem fallback para módulos do painel em caso de falha Stripe.
import { trustedStripeCheckoutUrl } from './stripe-checkout-client'
import './stripe-billing.css'

type Cycle = 'monthly' | 'semiannual' | 'annual'
type Price = { code: string; cycle: Cycle; amount: number; label: string; previousAmountCents?: number | null; promotion?: { label: string; originalMonthlyPrice: number } | null }
type State = {
  enabled: boolean
  required: boolean
  accessGranted: boolean
  status: string
  planCode: string | null
  cycle: Cycle | null
  paidUntil: string | null
  cancelAtPeriodEnd: boolean
  prices: Price[]
  referralCode?: string
  referralStatus?: string | null
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })
const plans = [{ code: 'bronze', name: 'Bronze' }, { code: 'prata', name: 'Prata' }, { code: 'ouro', name: 'Ouro' }]
const terms: { key: Cycle; label: string; desc: string }[] = [
  { key: 'monthly', label: 'Mensal', desc: 'Sem desconto' },
  { key: 'semiannual', label: 'Semestral', desc: '5% de desconto' },
  { key: 'annual', label: 'Anual', desc: '15% de desconto' },
]
const stripeHost = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'checkout.stripe.com' || url.hostname === 'billing.stripe.com' || url.hostname.endsWith('.stripe.com'))
  } catch { return false }
}

export default function ShopvaxStripeBilling() {
  const [state, setState] = useState<State | null>(null)
  const params = new URLSearchParams(window.location.search)
  const initialCycle = params.get('cycle')
  const [cycle, setCycle] = useState<Cycle>(initialCycle === 'semiannual' || initialCycle === 'annual' ? initialCycle : 'monthly')
  const resumePlan = ['bronze','prata','ouro'].includes(params.get('plan') || '') ? params.get('plan') : null
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() => params.get('checkout') === 'error' ? 'Sua conta foi criada, mas não foi possível abrir o checkout Stripe. Selecione o plano abaixo para tentar novamente; não crie outra conta.' : '')
  const [notice, setNotice] = useState('')
  const [referralCode, setReferralCode] = useState(() => (new URLSearchParams(window.location.search).get('ref') || '').toUpperCase().slice(0,40))

  const refresh = async () => {
    try {
      const current = await apiRequest<State>('/api/billing/status')
      setState(current)
      if(current.referralCode) setReferralCode(current.referralCode)
      if (params.get('checkout') !== 'error') setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a cobrança.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (params.get('stripe') !== 'success' || !state?.accessGranted) return
    // Só abrir o painel quando o webhook autenticado confirmar a assinatura.
    window.history.replaceState({}, '', '/painel')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [state?.accessGranted])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('stripe') !== 'success') return
    setNotice('Checkout concluído. Aguardando a confirmação segura da Stripe para liberar seu plano.')
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      void refresh()
      if (attempts >= 10) window.clearInterval(timer)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const act = async (endpoint: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiRequest<{ url?: string; message?: string; unchanged?: boolean }>(endpoint, { method: 'POST', body: JSON.stringify(body) })
      if (result.url) {
        if (endpoint === '/api/billing/checkout' ? !trustedStripeCheckoutUrl(result.url) : !stripeHost(result.url)) throw new Error('A Stripe retornou um endereço de cobrança inválido.')
        window.location.assign(result.url)
        return
      }
      setNotice(result.unchanged ? 'Este já é o seu plano atual.' : result.message || 'Solicitação registrada. Aguarde a confirmação.')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a operação.')
    } finally { setBusy(false) }
  }

  if (loading) return <div className="svx-billing"><p>Carregando cobrança segura…</p></div>
  if (state && !state.required && !['active','past_due','unpaid'].includes(state.status)) return <section className="svx-billing">
    <header className="svx-billing__header"><span className="svx-billing__eyebrow">SHOPVAX · ASSINATURA</span><h1>Plano e cobrança</h1></header>
    <p role="status">Seu acesso está liberado sem pagamento por enquanto. Nenhuma assinatura automática foi criada.</p>
    <p>Plano atual: <strong>{state.planCode?.toUpperCase() || 'BRONZE'}</strong>. Os limites do plano escolhido continuam valendo.</p>
  </section>
  if (!state?.enabled) return <div className="svx-billing"><p role="alert" className="svx-billing__error">Pagamento Stripe indisponível nesta instância. Sua conta está registrada, mas a assinatura não pode ser iniciada até que a conexão seja restabelecida.</p></div>

  const activeSubscription = state.status === 'active' && state.accessGranted
  const hasSubscription = !['none', 'canceled', 'incomplete_expired'].includes(state.status)
  const needsRegularization = hasSubscription && !activeSubscription
  const isShopping = !hasSubscription || activeSubscription
  const activePlanName = plans.find(plan => plan.code === state.planCode)?.name
  const priceLabel = (amount: number) => brl.format(amount / 100)

  return <section className="svx-billing">
    <header className="svx-billing__header">
      <span className="svx-billing__eyebrow">SHOPVAX / ASSINATURA</span>
      <h1>{activeSubscription ? 'Plano e cobrança' : needsRegularization ? 'Regularize seu pagamento' : 'Ative sua loja'}</h1>
      <p>{activeSubscription
        ? 'Consulte sua assinatura, gerencie cobranças ou escolha outro plano.'
        : needsRegularization
          ? 'O pagamento ainda não foi confirmado. A loja permanece protegida até a regularização.'
          : 'Escolha um plano e conclua a assinatura com segurança pela Stripe.'}</p>
    </header>

    <div className={`svx-billing__status ${activeSubscription ? 'is-active' : needsRegularization ? 'needs-action' : 'is-pending'}`}>
      <div className="svx-billing__status-main">
        <span className="svx-billing__status-icon" aria-hidden="true">{activeSubscription ? <ShieldCheck size={22}/> : <CreditCard size={22}/>}</span>
        <div>
          <span className="svx-billing__status-label">STATUS DA ASSINATURA</span>
          <h2>{activeSubscription ? 'Assinatura ativa' : needsRegularization ? 'Pagamento não confirmado' : 'Aguardando pagamento'}</h2>
          <p>{activeSubscription
            ? `${activePlanName || state.planCode?.toUpperCase() || 'Plano ativo'}${state.cycle ? ' · ' + terms.find(term => term.key === state.cycle)?.label : ''}${state.paidUntil ? ' · Pago até ' + day.format(new Date(state.paidUntil)) : ''}`
            : needsRegularization
              ? 'Abra a central de cobrança para verificar a fatura e atualizar o cartão. Não precisa criar outra conta.'
              : 'Sua conta foi criada. Escolha uma opção abaixo; o painel será liberado após a confirmação do pagamento.'}</p>
        </div>
      </div>
      <div className="svx-billing__status-actions">
        {hasSubscription && <button type="button" className={activeSubscription ? 'svx-billing__secondary' : 'svx-billing__primary'} onClick={() => void act('/api/billing/portal')} disabled={busy}>
          <CreditCard size={17}/>{activeSubscription ? 'Faturas e cartão' : 'Ver cobrança e atualizar cartão'}<ArrowUpRight size={16}/>
        </button>}
        <button className="svx-billing__secondary" type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16}/> Verificar pagamento</button>
      </div>
    </div>

    {notice && <p role="status" className="svx-billing__notice"><ShieldCheck size={18}/>{notice}</p>}
    {error && <p role="alert" className="svx-billing__error"><AlertCircle size={18}/>{error}</p>}

    {needsRegularization && <div className="svx-billing__guidance" role="note">
      <strong>Seu acesso continua bloqueado por segurança.</strong>
      <p>Se o cartão foi recusado, consulte a cobrança na Stripe e escolha outro meio de pagamento disponível. Após a Stripe confirmar o pagamento, toque em “Verificar pagamento”.</p>
    </div>}

    {isShopping && <>
      <div className="svx-billing__section-head">
        <div><span className="svx-billing__eyebrow">{activeSubscription ? 'SUA ASSINATURA' : 'ESCOLHA SEU PLANO'}</span><h2>{activeSubscription ? 'Outros planos' : 'Planos e preços'}</h2></div>
        {!activeSubscription && state.prices.some(price => price.promotion) && <span className="svx-billing__promo-tag">BLACK FRIDAY</span>}
      </div>
      <p className="svx-billing__section-subtitle">{activeSubscription
        ? 'Você pode comparar os planos e solicitar uma alteração quando precisar.'
        : 'Selecione a duração da assinatura e depois escolha Bronze, Prata ou Ouro.'}</p>
      <div className="svx-billing__term" role="group" aria-label="Período de cobrança">
        {terms.map(term => <button type="button" key={term.key} aria-pressed={cycle === term.key} className={cycle === term.key ? 'is-selected' : ''} onClick={() => setCycle(term.key)}>
          <strong>{term.label}</strong><small>{term.desc}</small>
        </button>)}
      </div>
      <div className="svx-billing__plans">
        {plans.map(plan => {
          const price = state.prices.find(item => item.code === plan.code && item.cycle === cycle)
          const current = activeSubscription && state.planCode === plan.code && state.cycle === cycle
          return <article key={plan.code} className={plan.code === resumePlan ? 'is-featured' : plan.code === 'prata' ? 'is-featured' : ''}>
            <div className="svx-billing__plan-top"><h3>{plan.name}</h3>{price?.promotion && <span>BLACK FRIDAY</span>}</div>
            <div className="svx-billing__price">
              {price?.promotion && price.previousAmountCents != null && <del>{priceLabel(price.previousAmountCents)}</del>}
              <strong>{price ? priceLabel(price.amount) : 'Indisponível'}</strong>
              <small>{cycle === 'monthly' ? 'por mês' : cycle === 'semiannual' ? 'a cada 6 meses' : 'por ano'}</small>
            </div>
            <p className="svx-billing__plan-note">{price?.promotion ? 'Preço promocional de Black Friday. ' : ''}Pagamento do período escolhido pela Stripe.</p>
            <button type="button" disabled={busy || current || !price}
              onClick={() => void act(activeSubscription ? '/api/billing/change' : '/api/billing/checkout', {
                planCode: plan.code, cycle, referralCode: !activeSubscription ? referralCode.trim() : undefined, requestId: crypto.randomUUID(),
              })}>
              {busy ? (activeSubscription ? 'Atualizando plano…' : 'Abrindo pagamento seguro…') : current ? 'Seu plano atual' : activeSubscription ? 'Alterar para ' + plan.name : 'Assinar ' + plan.name}
            </button>
          </article>
        })}
      </div>
      {!activeSubscription && <div className="svx-billing__referral">
        <label htmlFor="svx-billing-referral">Possui um código de indicação? <small>Opcional</small></label>
        <input id="svx-billing-referral" value={referralCode} maxLength={40} onChange={e => setReferralCode(e.target.value.toUpperCase())} disabled={Boolean(state.referralCode)} placeholder="SVX- OU SVP-" />
        <small>{state.referralCode ? 'Indicação vinculada à sua conta.' : 'Se tiver um código, informe antes de contratar. O benefício depende da confirmação do pagamento.'}</small>
      </div>}
    </>}

    <p className="svx-billing__fineprint">A assinatura é recorrente conforme o ciclo escolhido. Acesso e benefícios são liberados somente após a confirmação do pagamento pela Stripe. Alterações de planos ativos podem gerar cobranças proporcionais; cancelamentos e faturas são gerenciados na central segura.</p>
  </section>
}
