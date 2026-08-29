import { useEffect, useState } from 'react'
import { ArrowLeft, Check, CreditCard, PackageCheck, Save } from 'lucide-react'
import './commercial-settings.css'

type Item = { key: string; label: string }
type Payload = {
  paymentMethods: Item[]
  deliveryMethods: Item[]
  note: string
  informationalOnly: boolean
  disclaimer: string
  options: { payments: Record<string, string>; deliveries: Record<string, string> }
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

export default function CommercialSettingsPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [payments, setPayments] = useState<string[]>([])
  const [deliveries, setDeliveries] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const result = await request<Payload>('/api/admin/commercial-config')
      setData(result)
      setPayments(result.paymentMethods.map((item) => item.key))
      setDeliveries(result.deliveryMethods.map((item) => item.key))
      setNote(result.note)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar as configurações.') }
  }

  useEffect(() => { void load() }, [])

  const toggle = (current: string[], key: string, setter: (next: string[]) => void) => {
    setter(current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  const save = async () => {
    if (!data || saving) return
    setSaving(true); setError('')
    try {
      const result = await request<Payload>('/api/admin/commercial-config', { method: 'PUT', body: JSON.stringify({ paymentMethods: payments, deliveryMethods: deliveries, note }) })
      setData(result)
      setPayments(result.paymentMethods.map((item) => item.key))
      setDeliveries(result.deliveryMethods.map((item) => item.key))
      setNote(result.note)
      setNotice('Configurações comerciais atualizadas.')
      window.setTimeout(() => setNotice(''), 2200)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setSaving(false) }
  }

  if (!data) return <div className="commercial-shell"><div className="commercial-loading"><PackageCheck size={30}/><strong>Carregando opções comerciais…</strong>{error && <p>{error}</p>}</div></div>

  return <div className="commercial-shell">
    <header className="commercial-head"><button onClick={() => go('/painel')}><ArrowLeft size={18}/> Painel</button><div><span>Operação comercial</span><h1>Pagamento e entrega</h1><p>Mostre ao comprador quais opções a empresa costuma trabalhar, sem transformar o Atacado Shop em gateway ou sistema logístico.</p></div></header>
    {notice && <div className="commercial-toast"><Check size={16}/>{notice}</div>}
    {error && <div className="commercial-error">{error}</div>}
    <div className="commercial-rule"><strong>Somente informativo</strong><span>{data.disclaimer}</span></div>

    <section className="commercial-grid">
      <article className="commercial-card"><div className="commercial-card__head"><CreditCard size={20}/><div><span>Pagamento</span><h2>Formas aceitas</h2></div></div><div className="commercial-options">{Object.entries(data.options.payments).map(([key, label]) => <label key={key}><input type="checkbox" checked={payments.includes(key)} onChange={() => toggle(payments, key, setPayments)}/><span>{label}</span></label>)}</div></article>
      <article className="commercial-card"><div className="commercial-card__head"><PackageCheck size={20}/><div><span>Entrega</span><h2>Modalidades disponíveis</h2></div></div><div className="commercial-options">{Object.entries(data.options.deliveries).map(([key, label]) => <label key={key}><input type="checkbox" checked={deliveries.includes(key)} onChange={() => toggle(deliveries, key, setDeliveries)}/><span>{label}</span></label>)}</div></article>
    </section>

    <section className="commercial-card commercial-note"><div className="commercial-card__head"><div><span>Observação</span><h2>Mensagem comercial opcional</h2></div></div><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: prazos, condições e valores de frete são combinados diretamente com a vendedora."/><small>{note.length}/500</small></section>
    <div className="commercial-actions"><span>Nenhuma cobrança, cotação de frete ou rastreamento é executado por esta configuração.</span><button onClick={save} disabled={saving}><Save size={17}/>{saving ? 'Salvando…' : 'Salvar configurações'}</button></div>
  </div>
}
