import { useEffect, useState } from 'react'
import { AlertCircle, ArrowUpRight, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
import Phase5Panel from './Phase5Panel'
import './stripe-billing.css'

type Cycle = 'monthly' | 'semiannual' | 'annual'
type Price = { code: string; cycle: Cycle; amount: number; label: string }
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
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    try {
      const current = await apiRequest<State>('/api/billing/status')
      setState(current)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a cobrança.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
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
        if (!stripeHost(result.url)) throw new Error('A Stripe retornou um endereço de cobrança inválido.')
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
  if (!state?.enabled) return <Phase5Panel />

  const activeSubscription = state.status === 'active' && state.accessGranted
  const hasSubscription = state.status !== 'none' && state.status !== 'canceled' && state.status !== 'incomplete_expired'
  return <section className="svx-billing">
    <header className="svx-billing__header">
      <span className="svx-billing__eyebrow">SHOPVAX · ASSINATURA</span>
      <h1>Plano e cobrança</h1>
      <p>Seu catálogo vende pelo WhatsApp. Aqui você paga somente a assinatura do Shopvax, de forma segura pela Stripe.</p>
    </header>
    <div className="svx-billing__summary">
      <div><span>STATUS DA CONTA</span><strong>{!state.required && !state.planCode ? 'Conta legada' : activeSubscription ? 'Assinatura ativa' : state.status === 'past_due' ? 'Pagamento pendente' : state.status === 'canceled' ? 'Cancelada' : 'Aguardando pagamento'}</strong>
        <small>{state.cancelAtPeriodEnd ? 'Cancelamento agendado para o fim do período pago.' : state.paidUntil ? 'Período confirmado até ' + day.format(new Date(state.paidUntil)) : 'O acesso pago será liberado quando a Stripe confirmar o pagamento.'}</small>
      </div>
      <div><span>PLANO LIBERADO</span><strong>{state.planCode ? state.planCode.toUpperCase() : state.required ? 'Pendente' : 'Legado'}</strong><small>{state.cycle ? terms.find((term) => term.key === state.cycle)?.label : 'Sem cobrança recorrente ativa'}</small></div>
      <div className="svx-billing__actions">
        <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16}/> Atualizar</button>
        {hasSubscription && <button type="button" onClick={() => void act('/api/billing/portal')} disabled={busy}><CreditCard size={16}/> Faturas, cartão e cancelamento <ArrowUpRight size={14}/></button>}
      </div>
    </div>
    {notice && <p role="status" className="svx-billing__notice"><ShieldCheck size={16}/>{notice}</p>}
    {error && <p role="alert" className="svx-billing__error"><AlertCircle size={16}/>{error}</p>}
    <div className="svx-billing__term" aria-label="Ciclo de cobrança">
      {terms.map((term) => <button type="button" key={term.key} aria-pressed={cycle === term.key} className={cycle === term.key ? 'is-selected' : ''} onClick={() => setCycle(term.key)}><strong>{term.label}</strong><small>{term.desc}</small></button>)}
    </div>
    <div className="svx-billing__plans">
      {plans.map((plan) => {
        const price = state.prices.find((item) => item.code === plan.code && item.cycle === cycle)
        const current = activeSubscription && state.planCode === plan.code && state.cycle === cycle
        return <article key={plan.code} className={plan.code === 'prata' ? 'is-featured' : ''}>
          <span>{plan.code === 'prata' ? 'RECOMENDADO' : 'PLANO'}</span>
          <h2>{plan.name}</h2>
          <strong>{price ? brl.format(price.amount / 100) : 'Indisponível'}</strong>
          <p>Valor total do ciclo {terms.find((item) => item.key === cycle)?.label.toLowerCase()} em reais.</p>
          <button type="button" disabled={busy || current || !price || (hasSubscription && !activeSubscription)}
            onClick={() => void act(activeSubscription ? '/api/billing/change' : '/api/billing/checkout',
              { planCode: plan.code, cycle, requestId: crypto.randomUUID() })}>
            {busy ? 'Processando…' : current ? 'Plano atual' : activeSubscription ? 'Alterar plano' : hasSubscription ? 'Gerencie a cobrança acima' : 'Assinar com cartão'}
          </button>
        </article>
      })}
    </div>
    <p className="svx-billing__fineprint">Cobrança recorrente conforme o ciclo escolhido. Alterações podem gerar cobrança proporcional. O cancelamento pode ser feito na central segura da Stripe e não remove pedidos ou arquivos históricos. A liberação depende dos eventos de pagamento confirmados pelo servidor, nunca de um redirecionamento.</p>
  </section>
}
