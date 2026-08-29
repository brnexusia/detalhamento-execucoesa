import { useEffect, useState } from 'react'
import { ArrowLeft, Check, CreditCard, RefreshCcw, Save, Truck } from 'lucide-react'
import './commerce-info.css'

type Option = { key: string; label: string }
type Payload = {
  deliveryMethods: Option[]
  paymentMethods: Option[]
  availableDeliveryMethods: Option[]
  availablePaymentMethods: Option[]
  paymentProcessing: boolean
  freightCalculation: boolean
  notice: string
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || 'Não foi possível concluir a operação.')
  return body as T
}

export default function CommerceInfoPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [delivery, setDelivery] = useState<string[]>([])
  const [payment, setPayment] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const result = await request<Payload>('/api/admin/commerce-info')
      setData(result)
      setDelivery(result.deliveryMethods.map((item) => item.key))
      setPayment(result.paymentMethods.map((item) => item.key))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar as configurações.') }
  }

  useEffect(() => { void load() }, [])

  const toggle = (key: string, current: string[], set: (value: string[]) => void) => set(current.includes(key) ? current.filter((item) => item !== key) : [...current, key])

  const save = async () => {
    setSaving(true); setError('')
    try {
      const result = await request<Payload>('/api/admin/commerce-info', { method: 'PUT', body: JSON.stringify({ deliveryMethods: delivery, paymentMethods: payment }) })
      setData(result)
      setNotice('Configurações informativas salvas.')
      window.setTimeout(() => setNotice(''), 2200)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setSaving(false) }
  }

  if (!data) return <div className="commerce-shell"><div className="commerce-loading"><CreditCard size={30}/><strong>Carregando configurações…</strong>{error && <p>{error}</p>}</div></div>

  return <div className="commerce-shell">
    <header className="commerce-head"><button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button><div><span>Configuração comercial</span><h1>Pagamento e entrega</h1><p>Informe ao comprador como a loja trabalha, sem criar processamento ou cálculo automático.</p></div><button className="commerce-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></header>
    {notice && <div className="commerce-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="commerce-error">{error}</div>}
    <div className="commerce-rule"><strong>Somente informativo</strong><p>{data.notice}</p></div>

    <section className="commerce-grid">
      <article className="commerce-card"><div className="commerce-card__head"><Truck size={22}/><div><span>Módulo 6</span><h2>Formas de entrega</h2></div></div><div className="commerce-options">{data.availableDeliveryMethods.map((option) => <label key={option.key}><input type="checkbox" checked={delivery.includes(option.key)} onChange={() => toggle(option.key, delivery, setDelivery)}/><span>{option.label}</span></label>)}</div><small>Não há cotação automática de frete ou rastreamento.</small></article>
      <article className="commerce-card"><div className="commerce-card__head"><CreditCard size={22}/><div><span>Módulo 6</span><h2>Formas de pagamento</h2></div></div><div className="commerce-options">{data.availablePaymentMethods.map((option) => <label key={option.key}><input type="checkbox" checked={payment.includes(option.key)} onChange={() => toggle(option.key, payment, setPayment)}/><span>{option.label}</span></label>)}</div><small>O Atacado Shop não recebe nem processa o pagamento.</small></article>
    </section>
    <div className="commerce-actions"><span>Essas opções serão exibidas ao comprador como informação da loja.</span><button disabled={saving} onClick={save}><Save size={16}/>{saving ? 'Salvando…' : 'Salvar configuração'}</button></div>
  </div>
}
