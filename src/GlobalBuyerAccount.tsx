import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, LogOut, ShoppingBag, UserRound } from 'lucide-react'
import BuyerWhatsappLogin from './BuyerWhatsappLogin'
import { apiRequest } from './api'
import { notifyAuthChange } from './auth-session-sync'
import './customer-account.css'

type GlobalBuyer = {
  id: string
  phone: string
  name: string
  email: string
  profileCompleted: boolean
}

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Sem redirecionar para URL externa ou para páginas de administração.
function safeNext(): string {
  const value = new URLSearchParams(window.location.search).get('next') || ''
  if (['/', '/feed', '/descobrir'].includes(value)) return value
  if (/^\/(?:perfil|cliente)\/[a-z0-9_-]+$/i.test(value)) return value
  return ''
}

export default function GlobalBuyerAccount() {
  const [buyer, setBuyer] = useState<GlobalBuyer | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => {
    try {
      const result = await apiRequest<{buyer:GlobalBuyer}>('/api/public/buyer-auth/me')
      setBuyer(result.buyer)
      setError('')
      if (result.buyer.profileCompleted) {
        const destination = safeNext()
        if (destination) go(destination)
      }
      return true
    } catch (err) {
      setBuyer(null)
      const status = (err as Error & {status?:number}).status
      if (status !== 401) setError(err instanceof Error ? err.message : 'Não foi possível consultar sua conta.')
      return false
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const logout = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/public/customers/logout', {method:'POST'})
      setBuyer(null)
      notifyAuthChange('customer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível sair.')
    } finally { setBusy(false) }
  }

  return <main className="customer-page customer-global-page" style={{'--customer-accent':'#F25C05'} as React.CSSProperties}>
    <div className="customer-wrap">
      <button type="button" className="customer-back" onClick={() => go('/feed')}><ArrowLeft size={17}/> Voltar ao feed</button>
      <header className="customer-store-head"><span><ShoppingBag size={22}/></span><div><small>SHOPVAX · IDENTIDADE GERAL</small><strong>Conta do comprador</strong></div></header>
      <section className="customer-card customer-global-note">
        <CheckCircle2 size={20} aria-hidden="true"/>
        <div><strong>Uma conta para todas as lojas</strong><p>Seu cadastro é do ShopVax, não da loja em que você chegou. Compras, seguidores e pedidos continuam vinculados às respectivas lojas.</p></div>
      </section>
      {loading ? <section className="customer-card customer-loading"><UserRound size={26}/><strong>Abrindo sua conta…</strong></section> :
        buyer?.profileCompleted ? <>
          <section className="customer-card customer-profile">
            <div><small>Minha conta geral</small><h1>{buyer.name}</h1><p>{buyer.email}</p><p>{buyer.phone}</p></div>
            <button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={16}/>{busy ? 'Saindo…' : 'Sair'}</button>
          </section>
          <BuyerWhatsappLogin editOnly onVerified={refresh}/>
          <p className="customer-global-orders-hint">Para ver os pedidos feitos em uma loja específica, acesse a página daquela loja.</p>
        </> : <BuyerWhatsappLogin onVerified={refresh}/>}
      {error && <div role="alert" className="customer-error">{error}</div>}
    </div>
  </main>
}
