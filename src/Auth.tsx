import { useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Gift, Store, X } from 'lucide-react'
import { api } from './api'
import GoogleSignInButton from './GoogleSignInButton'

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
  const [plans, setPlans] = useState<SignupPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(mode === 'register')
  const [plansError, setPlansError] = useState('')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleSignup, setGoogleSignup] = useState<{ credential: string; name: string; email: string; picture?: string } | null>(null)
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
  const registrationMode = mode === 'register' || Boolean(googleSignup)

  useEffect(() => {
    if (!registrationMode) return
    const controller = new AbortController()

    setPlansLoading(true)
    setPlansError('')
    fetch('/api/public/plans', { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!Array.isArray(payload?.plans) || payload.plans.length === 0) throw new Error('Planos indisponíveis.')
        const nextPlans = (payload.plans as SignupPlan[]).map((plan) => ({ ...plan, name: planName(plan.code, plan.name) }))
        setPlans(nextPlans)
        setForm((current) => nextPlans.some((plan) => plan.code === current.planCode) ? current : { ...current, planCode: '' })
      })
      .catch((err) => { if (err?.name !== 'AbortError') setPlansError('Não foi possível carregar os planos. Tente novamente.') })
      .finally(() => setPlansLoading(false))

    return () => controller.abort()
  }, [registrationMode])

  const selectedPlan = plans.find((plan) => plan.code === form.planCode)

  const googleCredential = async (credential: string) => {
    setGoogleBusy(true)
    setError('')
    try {
      const result = await api.googleAuth({ credential, intent: 'login' })
      if (result.ok) {
        go(mode === 'login' ? requestedDestination() : '/painel')
        return
      }
      if (result.needsSignup) {
        setGoogleSignup({ credential, ...result.profile })
        setForm((current) => ({ ...current, name: result.profile.name || current.name, email: result.profile.email || current.email }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar com o Google.')
    } finally {
      setGoogleBusy(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (googleSignup) {
        if (!form.storeName.trim()) throw new Error('Informe o nome da sua loja.')
        if (!form.planCode) throw new Error('Selecione o plano da sua loja.')
        const result = await api.googleAuth({
          credential: googleSignup.credential,
          intent: 'register',
          storeName: form.storeName,
          whatsapp: form.whatsapp,
          planCode: form.planCode,
          referralCode: form.referralCode,
        })
        if (!result.ok) throw new Error('Não foi possível concluir o cadastro com Google.')
        go('/painel')
      } else if (mode === 'login') {
        await api.login({ email: form.email, password: form.password })
        go(requestedDestination())
      } else {
        if (!form.planCode) throw new Error('Selecione o plano da sua loja.')
        await api.register(form)
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
          <h1>{registrationMode ? 'Sua loja no ar. Sua vendedora no fechamento.' : 'Volte para a sua operação.'}</h1>
          <div className="poster-note">Catálogo + Feed + Carrinho + WhatsApp</div>
        </div>
      </aside>
      <main className="auth-panel">
        <button className="auth-close" onClick={() => go('/')} aria-label="Fechar"><X size={20} /></button>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form__head">
            <span className="brand__mark">SV</span>
            <p>{registrationMode ? 'Criar conta' : 'Entrar'}</p>
            <h2>{googleSignup ? 'Complete os dados da sua loja.' : registrationMode ? 'Monte sua loja em poucos minutos.' : 'Acesse seu painel.'}</h2>
          </div>
          {registrationMode && form.referralCode && <div className="poster-note"><Gift size={15}/> Indicação {form.referralCode} · quem indicou recebe 1 mês grátis após seu cadastro válido.</div>}
          {!googleSignup && <>
            <GoogleSignInButton mode={mode} disabled={googleBusy || busy} onCredential={googleCredential} />
            <div className="auth-divider"><span>ou</span></div>
          </>}
          {googleSignup && <div className="auth-google-profile">
            {googleSignup.picture ? <img src={googleSignup.picture} alt="" referrerPolicy="no-referrer"/> : <span>G</span>}
            <div><small>Conta Google confirmada</small><strong>{googleSignup.name}</strong><em>{googleSignup.email}</em></div>
          </div>}
          {registrationMode && (
            <>
              {!googleSignup && <label><span>Seu nome</span><input autoComplete="name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Felipe" required /></label>}
              <label><span>Nome da loja</span><div className="input-icon"><Store size={17} /><input value={form.storeName} onChange={(e) => update('storeName', e.target.value)} placeholder="Suprema Line" required /></div></label>
              <label><span>WhatsApp principal</span><input inputMode="tel" value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="55 11 99999-9999" /></label>
              <fieldset className="signup-plans">
                <legend>Escolha seu plano</legend>
                {plansLoading && <div className="signup-plans__state">Carregando planos…</div>}
                {plansError && <div className="signup-plans__state signup-plans__state--error">{plansError}</div>}
                {!plansLoading && !plansError && <div className="signup-plan-grid">
                  {plans.map((plan) => <button type="button" key={plan.code} className={form.planCode === plan.code ? 'signup-plan is-selected' : 'signup-plan'} onClick={() => update('planCode', plan.code)} aria-pressed={form.planCode === plan.code}>
                    <span>{plan.name}</span><strong>{planMoney.format(plan.monthlyPrice)}<small>/mês</small></strong><em>{planSummary(plan)}</em>
                  </button>)}
                </div>}
                <input className="signup-plan-required" tabIndex={-1} aria-hidden="true" value={form.planCode} onChange={() => undefined} required />
                {selectedPlan && <small className="signup-plan-choice">Selecionado: {selectedPlan.name}</small>}
              </fieldset>
            </>
          )}
          {!googleSignup && <>
            <label><span>E-mail</span><input type="email" autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="voce@empresa.com.br" required /></label>
            <label><span>Senha</span><div className="password-input"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Mínimo 8 caracteres" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          </>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-action" disabled={busy || googleBusy || (registrationMode && (plansLoading || Boolean(plansError)))}>{busy || googleBusy ? 'Aguarde…' : googleSignup ? 'Criar minha loja com Google' : mode === 'register' ? 'Criar minha loja' : 'Entrar'}<ArrowRight size={18} /></button>
          <p className="auth-switch">{registrationMode ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <button type="button" onClick={() => { setGoogleSignup(null); go(registrationMode ? '/entrar' : '/criar-conta') }}>{registrationMode ? 'Entrar' : 'Criar conta'}</button></p>
        </form>
      </main>
    </div>
  )
}
