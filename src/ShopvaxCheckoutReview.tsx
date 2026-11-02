import { useEffect, useState } from 'react'
import { ArrowRight, Check, MessageCircle, X } from 'lucide-react'
import type { CartItem } from './types'
import { SVRibbon } from './ShopvaxDesignSystem'
import './checkout-buyer.css'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export type CheckoutBuyer = {
  name: string; phone: string; email: string; document: string
  cep: string; state: string; city: string; neighborhood: string
  street: string; number: string; complement: string; reference: string
  deliveryMethod: string; busPlate: string; busColor: string; busIdentifier: string
}
const initial: CheckoutBuyer = {
  name: '', phone: '', email: '', document: '', cep: '', state: '', city: '',
  neighborhood: '', street: '', number: '', complement: '', reference: '',
  deliveryMethod: 'combinar', busPlate: '', busColor: '', busIdentifier: '',
}
const defaults = [
  { key: 'retirada', label: 'Retirada na loja' }, { key: 'motoboy', label: 'Motoboy' },
  { key: 'transportadora', label: 'Transportadora' }, { key: 'correios', label: 'Correios' },
  { key: 'entrega_propria', label: 'Entrega própria' }, { key: 'excursao', label: 'Ônibus de excursão' },
  { key: 'combinar', label: 'Combinar com a vendedora' },
]
const addressDelivery = new Set(['motoboy', 'transportadora', 'correios', 'entrega_propria'])
type Props = {
  items: CartItem[]; total: number; minimum: number
  storeName: string; storeSlug: string; sellerName: string
  sending: boolean; error: string; onClose: () => void
  onSubmit: (buyer: CheckoutBuyer, notes: string) => Promise<void>
}
export default function ShopvaxCheckoutReview({ items, total, minimum, storeName, storeSlug, sellerName, sending, error, onClose, onSubmit }: Props) {
  const [buyer, setBuyer] = useState<CheckoutBuyer>(initial)
  const [notes, setNotes] = useState('')
  const [showBuyer, setShowBuyer] = useState(true)
  const [deliveryOptions, setDeliveryOptions] = useState(defaults)
  const update = (key: keyof CheckoutBuyer, value: string) => setBuyer(current => ({ ...current, [key]: value }))
  useEffect(() => {
    if (!storeSlug) return
    const controller = new AbortController()
    fetch('/api/public/commercial-config/' + encodeURIComponent(storeSlug), { signal: controller.signal, credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { deliveryMethods?: Array<{ key: string; label: string }> } | null) => {
        const allowed = data?.deliveryMethods?.filter(option => defaults.some(item => item.key === option.key))
        if (!allowed?.length) return
        setDeliveryOptions(allowed)
        setBuyer(current => allowed.some(option => option.key === current.deliveryMethod) ? current : { ...current, deliveryMethod: allowed[0].key })
      }).catch(() => undefined)
    return () => controller.abort()
  }, [storeSlug])
  const validCep = !buyer.cep || buyer.cep.replace(/\D/g, '').length === 8
  const validPhone = !buyer.phone || buyer.phone.replace(/\D/g, '').length >= 10
  const validDocument = !buyer.document || [11, 14].includes(buyer.document.replace(/\D/g, '').length)
  const validEmail = !buyer.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)
  const needsAddress = addressDelivery.has(buyer.deliveryMethod)
  const hasAddress = !needsAddress || (buyer.cep.replace(/\D/g, '').length === 8 && buyer.state.trim().length === 2 &&
    Boolean(buyer.city.trim() && buyer.neighborhood.trim() && buyer.street.trim() && buyer.number.trim()))
  const hasBus = buyer.deliveryMethod !== 'excursao' || Boolean(buyer.busPlate.trim() && buyer.busColor.trim() && buyer.busIdentifier.trim())
  const canSend = items.length > 0 && total >= minimum && !sending && validCep && validPhone && validDocument && validEmail && hasAddress && hasBus
  return <div className="svx-review-layer" role="dialog" aria-modal="true" aria-labelledby="svx-review-title">
    <button type="button" className="svx-review-layer__backdrop" onClick={onClose} aria-label="Fechar revisão"/>
    <section className="svx-review">
      <SVRibbon><span>SHOPVAX · TALÃO DIGITAL</span><span>REVISE ANTES DE ENVIAR</span></SVRibbon>
      <header className="svx-review__head"><div><span className="svx-kicker">PEDIDO QUASE PRONTO</span><h2 id="svx-review-title">Confira seu talão.</h2><p>Revise as peças e abra o WhatsApp de {sellerName} para conversar sobre o pedido.</p></div><button type="button" onClick={onClose} aria-label="Fechar revisão"><X size={20}/></button></header>
      <div className="svx-review__scroll">
        <div className="svx-review__meta"><span>LOJA <strong>{storeName}</strong></span><span>ATENDIMENTO <strong>{sellerName}</strong></span></div>
        <div className="svx-review__items">{items.map((item, index) => <div className="svx-review__item" key={item.key}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.product.name}</strong><small>REF. {item.product.sku || '—'}</small><p>{Object.entries(item.selections).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p><small>{item.quantity} × {currency.format(item.product.price)}</small></div><strong>{currency.format(item.product.price * item.quantity)}</strong></div>)}</div>
        <div className="svx-review__total"><span>TOTAL DAS PEÇAS</span><strong>{currency.format(total)}</strong></div>
        <button type="button" className="svx-review__buyer-toggle" aria-expanded={showBuyer} onClick={() => setShowBuyer(!showBuyer)}>{showBuyer ? 'Ocultar informações de comprador e entrega' : 'Informações do comprador e entrega'}<ArrowRight size={17}/></button>
        {showBuyer && <div className="svx-review__buyer-fields svx-review__buyer-form">
          <div className="svx-review__buyer-heading">Seus dados <small>Informe os dados que a vendedora precisa para identificar e organizar a entrega. Não cria cadastro para publicidade.</small></div>
          <label>Nome completo<input value={buyer.name} maxLength={120} autoComplete="name" placeholder="Seu nome" onChange={e => update('name', e.target.value)}/></label>
          <label>WhatsApp<input value={buyer.phone} type="tel" maxLength={20} autoComplete="tel" placeholder="DDD + número" onChange={e => update('phone', e.target.value)}/></label>
          <label>E-mail<input value={buyer.email} type="email" maxLength={160} autoComplete="email" placeholder="Seu e-mail" onChange={e => update('email', e.target.value)}/></label>
          <label>CPF/CNPJ<input value={buyer.document} inputMode="numeric" maxLength={18} placeholder="CPF ou CNPJ" onChange={e => update('document', e.target.value)}/></label>
          <div className="svx-review__buyer-heading">Forma de entrega <small>Escolha conforme as opções da loja; prazo e frete são combinados com a vendedora.</small></div>
          <label className="svx-review__full">Modalidade<select aria-label="Forma de entrega" value={buyer.deliveryMethod} onChange={e => update('deliveryMethod', e.target.value)}>{deliveryOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          {buyer.deliveryMethod !== 'retirada' && <div className="svx-review__buyer-subgrid">
            <label>CEP<input value={buyer.cep} inputMode="numeric" autoComplete="postal-code" maxLength={9} placeholder="00000-000" onChange={e => update('cep', e.target.value)}/></label>
            <label>Estado (UF)<input value={buyer.state} maxLength={2} autoComplete="address-level1" placeholder="BA" onChange={e => update('state', e.target.value.toUpperCase())}/></label>
            <label>Cidade<input value={buyer.city} maxLength={100} autoComplete="address-level2" placeholder="Sua cidade" onChange={e => update('city', e.target.value)}/></label>
            <label>Bairro<input value={buyer.neighborhood} maxLength={100} autoComplete="address-level3" placeholder="Bairro" onChange={e => update('neighborhood', e.target.value)}/></label>
            <label>Rua / endereço<input value={buyer.street} maxLength={180} autoComplete="street-address" placeholder="Rua ou avenida" onChange={e => update('street', e.target.value)}/></label>
            <label>Número<input value={buyer.number} maxLength={25} placeholder="Número / S/N" onChange={e => update('number', e.target.value)}/></label>
            <label>Complemento<input value={buyer.complement} maxLength={120} placeholder="Bloco, apartamento..." onChange={e => update('complement', e.target.value)}/></label>
            <label>Ponto de referência<input value={buyer.reference} maxLength={180} placeholder="Ponto de referência" onChange={e => update('reference', e.target.value)}/></label>
          </div>}
          {buyer.deliveryMethod === 'excursao' && <div className="svx-review__buyer-subgrid">
            <div className="svx-review__buyer-heading">Ônibus de excursão <small>Identifique corretamente o transporte para a vendedora.</small></div>
            <label>Placa do ônibus<input value={buyer.busPlate} maxLength={15} placeholder="Placa" onChange={e => update('busPlate', e.target.value)}/></label>
            <label>Cor do ônibus<input value={buyer.busColor} maxLength={50} placeholder="Cor" onChange={e => update('busColor', e.target.value)}/></label>
            <label>Ônibus / excursão<input value={buyer.busIdentifier} maxLength={160} placeholder="Nome ou identificação do ônibus" onChange={e => update('busIdentifier', e.target.value)}/></label>
          </div>}
          {!validCep && <small role="alert">Informe um CEP válido de 8 dígitos.</small>}
          {!validPhone && <small role="alert">Informe um telefone válido ou deixe o campo em branco.</small>}
          {!validEmail && <small role="alert">Confira o e-mail informado.</small>}
          {!validDocument && <small role="alert">O CPF precisa ter 11 dígitos; o CNPJ, 14.</small>}
          {!hasAddress && <small role="alert">Para esta modalidade, informe CEP, UF, cidade, bairro, rua e número.</small>}
          {!hasBus && <small role="alert">Informe placa, cor e identificação do ônibus de excursão.</small>}
        </div>}
        <label className="svx-review__notes">Observações para a vendedora<textarea rows={3} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: separar outras cores, retirada na loja..."/></label>
        <p className="svx-review__privacy">Os dados informados serão incluídos no pedido da loja e na mensagem preparada para o WhatsApp. Eles não criam cadastro para receber publicidade.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="svx-review__footer"><span><Check size={15}/> {items.reduce((count, item) => count + item.quantity, 0)} peças conferidas</span><button disabled={!canSend} type="button" onClick={() => void onSubmit(buyer, notes)}><MessageCircle size={19}/>{sending ? 'Preparando talão…' : 'Preparar pedido para enviar'}<ArrowRight size={18}/></button><small>Abrir o WhatsApp não comprova que a mensagem foi enviada ou que a venda foi concluída.</small></footer>
    </section>
  </div>
}
