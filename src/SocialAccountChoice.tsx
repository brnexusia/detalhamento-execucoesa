import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ShoppingBag, Store, X } from 'lucide-react'
import './social-account-choice.css'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

type FollowResult = { following: boolean; followers: number }
type Props = {
  storeSlug?: string
  storeId?: string
  reason?: 'follow' | 'login'
  onClose: () => void
  onFollowed?: (result: FollowResult) => void
}

/** A escolha do perfil define qual cookie poderá autorizar o follow. */
export default function SocialAccountChoice({ storeSlug, storeId, reason = 'login', onClose, onFollowed }: Props) {
  const first = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    first.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const returnToProfile = storeSlug ? `/perfil/${encodeURIComponent(storeSlug)}` : '/feed'
  const loginAs = (role: 'comprador' | 'loja') => {
    onClose()
    const next = encodeURIComponent(returnToProfile)
    go(role === 'comprador' ? `/comprador?next=${next}` : `/entrar?next=${next}`)
  }

  const choose = async (role: 'comprador' | 'loja') => {
    if (busy) return
    if (reason !== 'follow' || !storeId) { loginAs(role); return }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/social/stores/${encodeURIComponent(storeId)}/follow`, {
        method: 'POST', credentials: 'include',
        headers: { 'x-shopvax-follow-role': role },
      })
      const body = await response.json().catch(() => null)
      if (response.status === 401) { loginAs(role); return }
      if (!response.ok) {
        setError(body?.error || 'Não foi possível seguir a loja. Tente novamente.')
        return
      }
      onFollowed?.({ following: Boolean(body?.following), followers: Number(body?.followers || 0) })
      onClose()
    } catch {
      setError('Não foi possível conectar. Verifique a internet e tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="social-account-choice-layer" role="presentation">
    <button className="social-account-choice-backdrop" type="button" onClick={onClose} disabled={busy} aria-label="Fechar seleção de conta"/>
    <section className="social-account-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="social-account-choice-title" aria-describedby="social-account-choice-subtitle">
      <button className="social-account-choice-close" type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20}/></button>
      <small>SHOPVAX · ACESSO</small>
      <h2 id="social-account-choice-title">{reason === 'follow' ? 'Você é loja ou comprador?' : 'Loja ou comprador?'}</h2>
      <p id="social-account-choice-subtitle">{reason === 'follow'
        ? 'Escolha com qual tipo de conta deseja seguir esta loja.'
        : 'Escolha como você quer entrar no ShopVax.'}</p>
      <div className="social-account-choice-options">
        <button ref={first} type="button" disabled={busy} onClick={() => void choose('comprador')}>
          <span className="social-account-choice-icon"><ShoppingBag size={22}/></span>
          <span><strong>Comprador</strong><small>Conta geral, válida em todas as lojas</small></span>
          <ArrowRight size={18}/>
        </button>
        <button type="button" disabled={busy} onClick={() => void choose('loja')}>
          <span className="social-account-choice-icon"><Store size={22}/></span>
          <span><strong>Loja</strong><small>Entrar com a conta de lojista</small></span>
          <ArrowRight size={18}/>
        </button>
      </div>
      {busy && <p role="status" className="social-account-choice-hint">Verificando sua conta…</p>}
      {error && <p role="alert" className="social-account-choice-hint">{error}</p>}
    </section>
  </div>
}
