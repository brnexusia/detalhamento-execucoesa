import { useEffect, useState } from 'react'
import { CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
import { notifyAuthChange } from './auth-session-sync'

type Buyer = {
  phone: string
  name: string
  document?: string
  cnpj?: string // Compatibilidade de perfis existentes.
  profileCompleted: boolean
}
type Stage = 'phone' | 'code' | 'profile'
type Form = { name: string; document: string }
const empty: Form = { name: '', document: '' }
const cleanDocument = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14)

export default function BuyerWhatsappLogin({ storeSlug = '', onVerified, editOnly = false }: {
  storeSlug?: string
  onVerified: () => Promise<boolean>
  editOnly?: boolean
}) {
  const [open, setOpen] = useState(!editOnly)
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [freshSignup, setFreshSignup] = useState(false)
  const [code, setCode] = useState('')
  const [form, setForm] = useState<Form>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expiresIn, setExpiresIn] = useState(0)

  useEffect(() => {
    let active = true
    setStage('phone')
    setOpen(!editOnly)
    setPhone('')
    setCode('')
    setError('')
    setCooldown(0)
    setExpiresIn(0)
    apiRequest<{ buyer: Buyer }>('/api/public/buyer-auth/me')
      .then(({ buyer }) => {
        if (!active) return
        setPhone(buyer.phone)
        setForm({ name: buyer.name || '', document: cleanDocument(buyer.document || buyer.cnpj || '') })
        if (!buyer.profileCompleted || editOnly) setStage('profile')
      }).catch(() => undefined)
    return () => { active = false }
  }, [storeSlug, editOnly])

  useEffect(() => {
    if (cooldown < 1 && expiresIn < 1) return
    const timer = window.setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1))
      setExpiresIn((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown, expiresIn])

  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setError('')
    setBusy(true)
    try { await action() }
    catch (err) { setError(err instanceof Error ? err.message : 'Tente novamente.') }
    finally { setBusy(false) }
  }
  const send = () => act(async () => {
    const response = await apiRequest<{ expiresInSeconds: number; resendAfterSeconds: number }>('/api/public/buyer-auth/request-code', {
      method: 'POST', body: JSON.stringify({ phone }),
    })
    setCode('')
    setStage('code')
    setCooldown(Math.max(0, Number(response.resendAfterSeconds) || 0))
    setExpiresIn(Math.max(0, Number(response.expiresInSeconds) || 0))
  })
  const verify = () => act(async () => {
    const response = await apiRequest<{ needsProfile: boolean; created: boolean; buyer: Buyer }>('/api/public/buyer-auth/verify-code', {
      method: 'POST', body: JSON.stringify({ phone, code }),
    })
    if (response.needsProfile) {
      setFreshSignup(response.created === true)
      setForm({
        name: response.buyer.name || '',
        document: cleanDocument(response.buyer.document || response.buyer.cnpj || ''),
      })
      setStage('profile')
    } else {
      notifyAuthChange('customer')
      await onVerified()
    }
  })
  const save = () => act(async () => {
    await apiRequest('/api/public/buyer-auth/profile', {
      method: 'PUT', body: JSON.stringify({
        name: form.name.trim(),
        document: cleanDocument(form.document),
      }),
    })
    // A associação comercial a uma loja continua opcional e posterior ao cadastro global.
    if (freshSignup && storeSlug && !editOnly) {
      await apiRequest('/api/public/buyer-auth/attribute-origin', {
        method: 'POST', body: JSON.stringify({ storeSlug }),
      }).catch(() => undefined)
    }
    notifyAuthChange('customer')
    if (editOnly) setOpen(false)
    await onVerified()
  })

  if (editOnly && !open) return <button className="buyer-profile-open" type="button" onClick={() => setOpen(true)}>Editar dados do comprador</button>

  return <section className="customer-card customer-auth buyer-whatsapp-auth">
    <div className="buyer-whatsapp-title">
      <ShieldCheck size={24} aria-hidden="true"/>
      <div><small>{editOnly ? 'Minha conta' : 'ShopVax · Comprador'}</small>
        <h1>{stage === 'phone' ? 'Entrar com WhatsApp' : stage === 'code' ? 'Verificar telefone' : editOnly ? 'Editar meus dados' : 'Cadastro de comprador'}</h1>
        <p>{stage === 'phone' ? 'Use seu telefone para entrar ou criar sua conta. Sem e-mail e sem senha.' :
          stage === 'code' ? 'Confirme o código enviado ao seu WhatsApp para proteger sua conta.' :
            'Somente nome, CPF/CNPJ e telefone. O mesmo cadastro funciona em todas as lojas.'}</p>
      </div>
    </div>
    {stage === 'phone' && <form onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label><span>Telefone com DDD</span>
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="(71) 99999-9999"
          value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required/>
      </label>
      <button className="customer-submit" type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}>
        <MessageCircle size={17}/> {busy ? 'Enviando…' : 'Receber código no WhatsApp'}
      </button>
    </form>}
    {stage === 'code' && <form onSubmit={(event) => { event.preventDefault(); void verify() }}>
      <p className="buyer-code-explanation" role="status">Código enviado para <strong>{phone}</strong>. {expiresIn > 0 ? `Expira em ${Math.ceil(expiresIn / 60)} min.` : 'O código expirou; solicite outro.'}</p>
      <label><span>Código de verificação</span>
        <input className="buyer-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required/>
      </label>
      <button className="customer-submit" type="submit" disabled={busy || code.length !== 6 || expiresIn < 1}>
        <CheckCircle2 size={17}/> {busy ? 'Validando…' : 'Confirmar código'}
      </button>
      <div className="buyer-inline-actions">
        <button type="button" disabled={busy} onClick={() => { setStage('phone'); setCode(''); setCooldown(0); setExpiresIn(0) }}>Alterar telefone</button>
        <button type="button" disabled={busy || cooldown > 0} onClick={() => void send()}>
          {cooldown ? 'Reenviar em ' + cooldown + 's' : 'Reenviar código'}
        </button>
      </div>
    </form>}
    {stage === 'profile' && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label><span>Nome completo</span>
        <input autoComplete="name" maxLength={120} minLength={2} required
          value={form.name} onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))}/>
      </label>
      <label><span>CPF ou CNPJ</span>
        <input autoComplete="off" inputMode="text" maxLength={18} required
          placeholder="CPF (11) ou CNPJ (14 caracteres)"
          value={form.document} onChange={(e) => setForm((old) => ({ ...old, document: cleanDocument(e.target.value) }))}/>
      </label>
      <label><span>Telefone verificado</span>
        <input type="tel" autoComplete="off" value={phone} readOnly aria-readonly="true"/>
      </label>
      <p className="buyer-simple-privacy">Seus dados serão usados para identificar sua conta e seus pedidos.
        Consulte nossa <a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">política de privacidade</a>.</p>
      <button type="submit" className="customer-submit" disabled={busy || form.name.trim().length < 2 || ![11, 14].includes(cleanDocument(form.document).length)}>
        {busy ? 'Salvando…' : editOnly ? 'Salvar alterações' : 'Concluir cadastro'}
      </button>
      {editOnly && <button type="button" className="buyer-secondary" onClick={() => setOpen(false)}>Cancelar</button>}
    </form>}
    {error && <div role="alert" className="customer-error">{error}</div>}
  </section>
}
