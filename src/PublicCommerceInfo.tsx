import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Info, Truck, X } from 'lucide-react'
import './commerce-info.css'

type Option = { key: string; label: string }
type Payload = { deliveryMethods: Option[]; paymentMethods: Option[]; paymentProcessing: boolean; freightCalculation: boolean; notice: string }

export default function PublicCommerceInfo() {
  const storeSlug = useMemo(() => window.location.pathname.split('/').filter(Boolean)[0] || '', [])
  const [data, setData] = useState<Payload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!storeSlug) return
    fetch(`/api/public/commerce-info/${encodeURIComponent(storeSlug)}`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => setData(result))
      .catch(() => undefined)
  }, [storeSlug])

  if (!data || (!data.deliveryMethods.length && !data.paymentMethods.length)) return null

  return <>
    <button className="commerce-public-trigger" type="button" onClick={() => setOpen(true)}><Info size={17}/> Pagamento e entrega</button>
    {open && <div className="commerce-public-layer"><button className="commerce-public-backdrop" onClick={() => setOpen(false)} aria-label="Fechar"/><section className="commerce-public-modal"><button className="commerce-public-close" onClick={() => setOpen(false)}><X size={19}/></button><span>Informações da loja</span><h2>Pagamento e entrega</h2>
      {data.deliveryMethods.length > 0 && <div className="commerce-public-group"><div><Truck size={19}/><strong>Entrega</strong></div><p>{data.deliveryMethods.map((item) => item.label).join(' · ')}</p></div>}
      {data.paymentMethods.length > 0 && <div className="commerce-public-group"><div><CreditCard size={19}/><strong>Pagamento</strong></div><p>{data.paymentMethods.map((item) => item.label).join(' · ')}</p></div>}
      <small>{data.notice}</small>
    </section></div>}
  </>
}
