import { useEffect, useState } from 'react'
import { CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
import { notifyAuthChange } from './auth-session-sync'

type Buyer = {
  phone: string; name: string; email: string; purpose: string; city: string; state: string;
  businessStatus: string; businessName: string; cnpjStatus: string; cnpj: string;
  channels: string[]; segment: string; instagram: string; profileCompleted: boolean;
  marketingConsent: boolean;
}
type Stage = 'phone' | 'code' | 'profile'
type Form = {
  name: string; email: string; purpose: string; city: string; state: string;
  businessStatus: string; businessName: string; cnpjStatus: string; cnpj: string;
  channels: string[]; segment: string; instagram: string; marketingConsent: boolean;
}
const empty: Form = {
  name: '', email: '', purpose: 'revenda', city: '', state: '',
  businessStatus: 'sim', businessName: '', cnpjStatus: 'nao',
  cnpj: '', channels: [], segment: '', instagram: '', marketingConsent: false,
}
const channels = [
  ['loja', 'Loja física'], ['virtual', 'Loja virtual'], ['social', 'Instagram e redes sociais'],
  ['whatsapp', 'WhatsApp'], ['market', 'Marketplaces'], ['autonomo', 'Revenda autônoma'], ['outros', 'Outros'],
]
export default function BuyerWhatsappLogin({ storeSlug, onVerified, editOnly = false }: {
  storeSlug: string; onVerified: () => Promise<boolean>; editOnly?: boolean;
}) {
  const [open, setOpen] = useState(!editOnly)
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [form, setForm] = useState<Form>(empty)
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    let active = true
    setStage('phone'); setOpen(!editOnly); setPhone(''); setCode(''); setError('')
    apiRequest<{ buyer: Buyer }>('/api/public/buyer-auth/me')
      .then(({ buyer }) => {
        if (!active) return
        setPhone(buyer.phone)
        setForm({
          name: buyer.name || '', email: buyer.email || '', purpose: buyer.purpose || 'revenda',
          city: buyer.city || '', state: buyer.state || '', businessStatus: buyer.businessStatus || 'sim',
          businessName: buyer.businessName || '', cnpjStatus: buyer.cnpjStatus || 'nao', cnpj: buyer.cnpj || '',
          channels: buyer.channels || [], segment: buyer.segment || '', instagram: buyer.instagram || '',
          marketingConsent: buyer.marketingConsent === true,
        })
        if (!buyer.profileCompleted || editOnly) {
          setStage('profile')
          setPrivacy(buyer.profileCompleted)
        }
      }).catch(() => undefined)
    return () => { active = false }
  }, [storeSlug, editOnly])

  useEffect(() => {
    if (cooldown < 1) return
    const timer = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const change = (field: keyof Form, value: string | boolean | string[]) => {
    setForm((old) => ({ ...old, [field]: value }))
  }
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setError(''); setBusy(true)
    try { await action() }
    catch (err) { setError(err instanceof Error ? err.message : 'Tente novamente.') }
    finally { setBusy(false) }
  }
  const send = () => act(async () => {
    await apiRequest('/api/public/buyer-auth/request-code', {
      method: 'POST', body: JSON.stringify({ phone, storeSlug }),
    })
    setCode(''); setStage('code'); setCooldown(60)
  })
  const verify = () => act(async () => {
    const response = await apiRequest<{ needsProfile: boolean; buyer: Buyer }>('/api/public/buyer-auth/verify-code', {
      method: 'POST', body: JSON.stringify({ phone, code, storeSlug }),
    })
    if (response.needsProfile) {
      setStage('profile')
      setPrivacy(false)
    } else {
      notifyAuthChange('customer')
      await onVerified()
    }
  })
  const save = () => act(async () => {
    await apiRequest('/api/public/buyer-auth/profile', {
      method: 'PUT', body: JSON.stringify({ ...form, privacyAccepted: privacy }),
    })
    notifyAuthChange('customer')
    if (editOnly) setOpen(false)
    await onVerified()
  })

  if (editOnly && !open) return <button className="buyer-profile-open" type="button" onClick={() => setOpen(true)}>Editar perfil comercial</button>

  return <section className="customer-card customer-auth buyer-whatsapp-auth">
    <div className="buyer-whatsapp-title">
      <ShieldCheck size={24} aria-hidden="true"/>
      <div><small>{editOnly ? 'Minha conta' : 'ShopVax · Conta do comprador'}</small>
        <h1>{stage === 'phone' ? 'Entrar com WhatsApp' : stage === 'code' ? 'Verificar WhatsApp' : 'Seu perfil de comprador'}</h1>
        <p>{stage === 'phone' ? 'Sem e-mail ou senha para entrar. Use o mesmo número em todas as lojas.' :
          stage === 'code' ? 'Digite o código enviado pela central ShopVax.' : 'Conte um pouco sobre você e como compra.'}</p>
      </div>
    </div>
    {stage === 'phone' && <form onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label><span>Número com DDD</span>
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="(71) 99999-9999"
          value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required/>
      </label>
      <button className="customer-submit" type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}>
        <MessageCircle size={17}/> {busy ? 'Enviando…' : 'Receber código no WhatsApp'}
      </button>
    </form>}
    {stage === 'code' && <form onSubmit={(event) => { event.preventDefault(); void verify() }}>
      <p className="buyer-code-explanation">Enviamos um código para <strong>{phone}</strong>.</p>
      <label><span>Código de 6 dígitos</span>
        <input className="buyer-otp-input" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required/>
      </label>
      <button className="customer-submit" type="submit" disabled={busy || code.length !== 6}>
        <CheckCircle2 size={17}/> {busy ? 'Validando…' : 'Confirmar código'}
      </button>
      <div className="buyer-inline-actions">
        <button type="button" disabled={busy} onClick={() => { setStage('phone'); setCode(''); setCooldown(0) }}>Alterar número</button>
        <button type="button" disabled={busy || cooldown > 0} onClick={() => void send()}>
          {cooldown ? 'Reenviar em ' + cooldown + 's' : 'Reenviar código'}
        </button>
      </div>
    </form>}
    {stage === 'profile' && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label><span>Nome completo *</span><input autoComplete="name" maxLength={120} required value={form.name} onChange={(e) => change('name', e.target.value)}/></label>
      <label><span>E-mail *</span><input type="email" autoComplete="email" maxLength={240} required value={form.email} onChange={(e) => change('email', e.target.value)}/></label>
      <div className="buyer-two-columns">
        <label><span>Cidade</span><input autoComplete="address-level2" value={form.city} onChange={(e) => change('city',e.target.value)}/></label>
        <label><span>UF</span><input maxLength={2} autoComplete="address-level1" placeholder="BA" value={form.state} onChange={(e) => change('state',e.target.value.toUpperCase())}/></label>
      </div>
      <label><span>Como você pretende comprar? *</span>
        <select value={form.purpose} onChange={(e) => change('purpose',e.target.value)}>
          <option value="revenda">Para revender</option>
          <option value="ambos">Para revender e uso pessoal</option>
          <option value="pessoal">Somente consumo próprio</option>
          <option value="futuro">Quero começar a revender</option>
        </select>
      </label>
      {form.purpose !== 'pessoal' && <>
        <label><span>Você possui um negócio?</span>
          <select value={form.businessStatus} onChange={(e) => change('businessStatus',e.target.value)}>
            <option value="sim">Sim</option><option value="nao">Revendo informalmente</option><option value="abrindo">Estou começando</option>
          </select>
        </label>
        <fieldset className="buyer-channels">
          <legend>Onde vende ou pretende vender?</legend>
          {channels.map(([value, label]) => <label key={value}><input type="checkbox"
            checked={form.channels.includes(value)}
            onChange={(e) => change('channels', e.target.checked ? [...form.channels, value] : form.channels.filter((c) => c !== value))}/>
            {label}</label>)}
        </fieldset>
        <label><span>Nome da loja ou empresa (opcional)</span><input maxLength={160} value={form.businessName} onChange={(e) => change('businessName',e.target.value)}/></label>
        <label><span>Possui CNPJ?</span>
          <select value={form.cnpjStatus} onChange={(e) => change('cnpjStatus',e.target.value)}>
            <option value="nao">Não</option><option value="sim">Sim</option><option value="processo">Em processo de abertura</option>
          </select>
        </label>
        {form.cnpjStatus === 'sim' && <label><span>CNPJ (opcional)</span><input inputMode="numeric" maxLength={18}
          value={form.cnpj} onChange={(e) => change('cnpj',e.target.value)}/></label>}
        <label><span>Segmento comercial</span><select value={form.segment} onChange={(e) => change('segment',e.target.value)}>
          <option value="">Selecionar (opcional)</option>
          <option value="Moda e vestuário">Moda e vestuário</option><option value="Joias e acessórios">Joias e acessórios</option>
          <option value="Cosméticos e beleza">Cosméticos e beleza</option><option value="Casa e decoração">Casa e decoração</option>
          <option value="Eletrônicos">Eletrônicos</option><option value="Variedades">Variedades</option><option value="Outros">Outros</option>
        </select></label>
        <label><span>Instagram comercial (opcional)</span><input maxLength={100} value={form.instagram} onChange={(e) => change('instagram',e.target.value)}/></label>
      </>}
      <label className="buyer-consent"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required/>
        Li e aceito a política de privacidade e o compartilhamento dos dados comerciais com lojas com as quais eu interagir.</label>
      <label className="buyer-consent"><input type="checkbox" checked={form.marketingConsent} onChange={(e) => change('marketingConsent',e.target.checked)}/>
        Aceito receber comunicações promocionais (opcional).</label>
      <button type="submit" className="customer-submit" disabled={busy || !privacy}>{busy ? 'Salvando…' : 'Salvar perfil e continuar'}</button>
      {editOnly && <button type="button" className="buyer-secondary" onClick={() => setOpen(false)}>Cancelar</button>}
    </form>}
    {error && <div role="alert" className="customer-error">{error}</div>}
  </section>
}
