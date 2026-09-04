import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, Store, X } from 'lucide-react'
import { api } from './api'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function requestedDestination() {
  const next = new URLSearchParams(window.location.search).get('next') || ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/painel'
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', password: '', storeName: '', whatsapp: '' })

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') {
        await api.login({ email: form.email, password: form.password })
        go(requestedDestination())
      } else {
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
          {mode === 'register' && (
            <>
              <label><span>Seu nome</span><input autoComplete="name" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Felipe" required /></label>
              <label><span>Nome da loja</span><div className="input-icon"><Store size={17} /><input value={form.storeName} onChange={(e) => update('storeName', e.target.value)} placeholder="Suprema Line" required /></div></label>
              <label><span>WhatsApp principal</span><input inputMode="tel" value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="55 11 99999-9999" /></label>
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
