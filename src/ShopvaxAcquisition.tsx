import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { apiRequest } from './api'
import './shopvax-growth.css'

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export default function ShopvaxAcquisition() {
  const storeSlug = useMemo(() => window.location.pathname.split('/').filter(Boolean)[0] || '', [])
  const [visible, setVisible] = useState(false)
  const storageKey = 'shopvax:visitor-offer-dismissed:v1:' + storeSlug
  useEffect(() => {
    if (!storeSlug || storeSlug === 'demo') return
    let cancelled = false
    apiRequest('/api/public/store/' + encodeURIComponent(storeSlug) + '/customers/me')
      .then(() => { if (!cancelled) setVisible(false) })
      .catch((err: Error & { status?: number }) => {
        if (cancelled || err.status !== 401) return
        let last = 0
        try { last = Number(localStorage.getItem(storageKey) || 0) } catch { /* privacidade do navegador */ }
        setVisible(!last || Date.now() - last >= COOLDOWN_MS)
      })
    return () => { cancelled = true }
  }, [storeSlug, storageKey])
  const dismiss = () => {
    try { localStorage.setItem(storageKey, String(Date.now())) } catch { /* sem persistência */ }
    setVisible(false)
  }
  if (!visible) return null
  return <aside className="svx-acquisition" aria-label="Convite para criar conta de comprador">
    <button type="button" className="svx-acquisition__close" onClick={dismiss} aria-label="Fechar convite"><X size={18}/></button>
    <span className="svx-kicker">ACOMPANHE SEUS PEDIDOS</span>
    <strong>Quer uma conta de comprador?</strong>
    <p>Cadastre-se para consultar seu histórico de pedidos nesta loja. Receber ofertas é uma escolha separada e opcional.</p>
    <a href={'/cliente/' + encodeURIComponent(storeSlug)} onClick={dismiss}>Conhecer minha conta <ArrowRight size={16}/></a>
  </aside>
}
