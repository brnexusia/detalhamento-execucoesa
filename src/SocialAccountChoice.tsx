import { useEffect, useRef } from 'react'
import { ArrowRight, ShoppingBag, Store, X } from 'lucide-react'
import './social-account-choice.css'

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

type Props = {
  storeSlug?: string
  reason?: 'follow' | 'login'
  onClose: () => void
}

/** Escolha explicita de identidade, sem misturar a conta da loja com a do comprador. */
export default function SocialAccountChoice({ storeSlug, reason = 'login', onClose }: Props) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    first.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const returnToProfile = storeSlug ? `/perfil/${encodeURIComponent(storeSlug)}` : '/'
  const asSeller = () => {
    onClose()
    go(`/entrar?next=${encodeURIComponent(returnToProfile)}`)
  }
  const asBuyer = () => {
    if (!storeSlug) return
    onClose()
    go(`/cliente/${encodeURIComponent(storeSlug)}?next=${encodeURIComponent(returnToProfile)}`)
  }

  return <div className="social-account-choice-layer" role="presentation">
    <button className="social-account-choice-backdrop" type="button" onClick={onClose} aria-label="Fechar seleção de conta"/>
    <section className="social-account-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="social-account-choice-title" aria-describedby="social-account-choice-subtitle">
      <button className="social-account-choice-close" type="button" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      <small>SHOPVAX · ACESSO</small>
      <h2 id="social-account-choice-title">Comprador ou vendedor?</h2>
      <p id="social-account-choice-subtitle">{reason === 'follow'
        ? 'Para seguir esta loja, entre com sua conta de comprador ou vendedor.'
        : 'Escolha como você quer entrar no ShopVax.'}</p>
      <div className="social-account-choice-options">
        <button ref={first} type="button" disabled={!storeSlug} onClick={asBuyer}>
          <span className="social-account-choice-icon"><ShoppingBag size={22}/></span>
          <span><strong>Comprador</strong><small>Entrar com minha conta de comprador</small></span>
          <ArrowRight size={18}/>
        </button>
        <button type="button" onClick={asSeller}>
          <span className="social-account-choice-icon"><Store size={22}/></span>
          <span><strong>Vendedor</strong><small>Entrar com a conta da loja</small></span>
          <ArrowRight size={18}/>
        </button>
      </div>
      {!storeSlug && <p className="social-account-choice-hint">Para entrar como comprador, abra primeiro o perfil de uma loja.</p>}
    </section>
  </div>
}
