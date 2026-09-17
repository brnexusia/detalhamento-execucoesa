import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Gift, Store, X } from 'lucide-react'
import { api } from './api'

type SignupPlan = {
  code: string
  name: string
  monthlyPrice: number
  sellerLimit: number | null
  productLimit: number | null
  catalogLimit: number | null
  photoLimit: number | null
  franchiseeLimit: number | null
}

const planName = (code: string, fallback = '') => ({ bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro' } as Record<string, string>)[code] || fallback

const fallbackPlans: SignupPlan[] = [
  { code: 'bronze', name: 'Bronze', monthlyPrice: 49.90, sellerLimit: 2, productLimit: null, catalogLimit: 1, photoLimit: 5, franchiseeLimit: 0 },
  { code: 'prata', name: 'Prata', monthlyPrice: 94.90, sellerLimit: 4, productLimit: null, catalogLimit: 3, photoLimit: 10, franchiseeLimit: 2 },
  { code: 'ouro', name: 'Ouro', monthlyPrice: 144.90, sellerLimit: null, productLimit: null, catalogLimit: null, photoLimit: 10, franchiseeLimit: null },
]

const planMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function requestedDestination() {
  const next = new URLSearchParams(window.location.search).get('next') || ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/painel'
}

function requestedReferral() {
  return (new URLSearchParams(window.location.search).get('ref') || '').trim().toUpperCase().slice(0, 40)
}

function requestedPlan() {
  const plan = (new URLSearchParams(window.location.search).get('plan') || '').trim().toLowerCase()
  return ['bronze', 'prata', 'ouro'].includes(plan) ? plan : ''
}

function planSummary(plan: SignupPlan) {
  const sellers = plan.sellerLimit == null ? 'vendedoras ilimitadas' : `${plan.sellerLimit} vendedoras`
  const catalogs = plan.catalogLimit == null ? 'catálogos ilimitados' : `${plan.catalogLimit} ${plan.catalogLimit === 1 ? 'catálogo' : 'catálogos'}`
  const photos = plan.photoLimit == null ? 'fotos ilimitadas' : `${plan.photoLimit} fotos por produto`
  return `${sellers} · ${catalogs} · ${photos}`
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [plans, setPlans] = useState<SignupPlan[]>(fallbackPlans)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    storeName: '',
    whatsapp: '',
    referralCode: mode === 'register' ? requestedReferral() : '',
    planCode: mode === 'register' ? requestedPlan() : '',
  })

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (mode !== 'register') return
    const controller = new AbortController()

    fetch('/api/public/plans', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!Array.isArray(payload?.plans) || payload.plans.length === 0) return
        const nextPlans = (payload.plans as SignupPlan[]).map((plan) => ({ ...plan, name: planName(plan.code, plan.name) }))
        setPlans(nextPlans)
        setForm((current) => nextPlans.some((plan) => plan.code === current.planCode) ? current : { ...current, planCode: '' })
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [mode])

  const selectedPlan = plans.find((plan) => plan.code === form.planCode)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') {
        await api.login({ email: form.email, password: form.password })
        go(requestedDestination())
      } else {
        if (!form.planCode) throw new Error('Selecione o plano da sua loja.')
        await api.register(form)
        const response = await fetch('/api/account/plan', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planCode: form.planCode }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || 'A conta foi criada, mas não foi possível aplicar o plano selecionado.')
        go('/painel')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-poster">
        <button className="wordmark" onClick={() => go('/')}><span>SV</span> Shopvax</button>
        <div className="auth-poster__copy">
          <p>Venda assistida para atacado.</p>
          <h1>{mode === 'register' ? 'Sua loja no ar. Sua vendedora no fechamento.' : 'Volte para a sua operação.'}</h1>
          <div className="poster-note">Catálogo + Feed + Carrinho + WhatsApp</div>
        </div>
      </aside>
      <main className="auth-panel">
        <button className="auth-close" onClick={() => go('/')} aria-label="Fechar"><X size={20} /></button>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form__head">
            <span className="brand__mark">SV</span>
            <p>{mode === 'register' ? 'Criar conta' : 'Entrar'}</p>
            <h2>{mode === 'register' ? 'Monte sua loja em poucos minutos.' : 'Acesse seu painel.'}</h2>
          </div>
          {mode === 'register' && form.referralCode && <div className="poster-note"><Gift size={15}/> Indicação {form.referralCode} · quem indicou recebe 1 mês grátis após seu cadastro válido.</div>}
          {mode === 'register' && (
            <>
              <label><span>Seu nome</span><input autoComplete="name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Felipe" required /></label>
              <label><span>Nome da loja</span><div className="input-icon"><Store size={17} /><input value={form.storeName} onChange={(e) => update('storeName', e.target.value)} placeholder="Suprema Line" required /></div></label>
              <label><span>WhatsApp principal</span><input inputMode="tel" value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="55 11 99999-9999" /></label>
              <label>
                <span>Plano</span>
                <select
                  value={form.planCode}
                  onChange={(e) => update('planCode', e.target.value)}
                  required
                  style={{ width: '100%', border: '1px solid var(--line)', outline: 0, background: '#fff', padding: '11px 12px', fontSize: 12 }}
                >
                  <option value="" disabled>Selecione seu plano</option>
                  {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} — {planMoney.format(plan.monthlyPrice)}/mês</option>)}
                </select>
                {selectedPlan && <small style={{ color: 'var(--muted)', fontSize: 9, lineHeight: 1.45 }}>{planSummary(selectedPlan)}</small>}
              </label>
            </>
          )}
          <label><span>E-mail</span><input type="email" autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="voce@empresa.com.br" required /></label>
          <label><span>Senha</span><div className="password-input"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Mínimo 8 caracteres" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" disabled={busy}>{busy ? 'Aguarde…' : mode === 'register' ? 'Criar minha loja' : 'Entrar'}<ArrowRight size={18} /></button>
          <p className="auth-switch">{mode === 'register' ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <button type="button" onClick={() => go(mode === 'register' ? '/entrar' : '/criar-conta')}>{mode === 'register' ? 'Entrar' : 'Criar conta'}</button></p>
        </form>
      </main>
    </div>
  )
}
