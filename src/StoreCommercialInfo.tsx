import { useEffect, useState } from 'react'
import { ChevronDown, Truck, Wallet } from 'lucide-react'
import './store-commercial-info.css'

type Method = { key: string; label: string }
type CommercialConfig = {
  paymentMethods: Method[]
  deliveryMethods: Method[]
  note: string
  informationalOnly: boolean
  disclaimer: string
}

/** Informações opcionais da loja dentro do fluxo do catálogo, nunca sobre a vitrine. */
export default function StoreCommercialInfo({ storeSlug }: { storeSlug: string }) {
  const [config, setConfig] = useState<CommercialConfig | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setConfig(null)
    if (!storeSlug) return () => controller.abort()
    fetch(`/api/public/commercial-config/${encodeURIComponent(storeSlug)}`, {
      credentials: 'include', signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<CommercialConfig> : null)
      .then((result) => {
        if (!controller.signal.aborted && result?.informationalOnly) setConfig(result)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [storeSlug])

  if (!config) return null
  return <details className="svx-commercial-info">
    <summary><span><Wallet size={18} aria-hidden="true" /> Pagamento e entrega</span><ChevronDown size={19} aria-hidden="true" /></summary>
    <div className="svx-commercial-info__body">
      <div><strong><Wallet size={16} aria-hidden="true" /> Formas de pagamento</strong>
        <p>{config.paymentMethods?.map((item) => item.label).filter(Boolean).join(' · ') || 'Combine com a vendedora.'}</p>
      </div>
      <div><strong><Truck size={16} aria-hidden="true" /> Formas de entrega</strong>
        <p>{config.deliveryMethods?.map((item) => item.label).filter(Boolean).join(' · ') || 'Combine com a vendedora.'}</p>
      </div>
      {config.note && <p className="svx-commercial-info__note">{config.note}</p>}
      <small>{config.disclaimer || 'Condições informativas. Confirme os detalhes pelo WhatsApp.'}</small>
    </div>
  </details>
}
