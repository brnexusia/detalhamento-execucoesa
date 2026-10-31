import { useEffect, useRef, useState } from 'react'
import { api } from './api'

type CredentialResponse = { credential?: string }

type GoogleAccounts = {
  id: {
    initialize: (config: {
      client_id: string
      callback: (response: CredentialResponse) => void
      auto_select?: boolean
      cancel_on_tap_outside?: boolean
    }) => void
    renderButton: (element: HTMLElement, options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black'
      size?: 'large' | 'medium' | 'small'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      logo_alignment?: 'left' | 'center'
      width?: number
      locale?: string
    }) => void
    cancel: () => void
  }
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts }
  }
}

let googleScriptPromise: Promise<void> | null = null

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (googleScriptPromise) return googleScriptPromise

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-shopvax-google-identity]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o login do Google.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.shopvaxGoogleIdentity = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Não foi possível carregar o login do Google.'))
    document.head.appendChild(script)
  })

  return googleScriptPromise.catch((error) => { googleScriptPromise = null; throw error })
}

export default function GoogleSignInButton({
  mode,
  disabled = false,
  onCredential,
  onUnavailable,
}: {
  mode: 'login' | 'register'
  disabled?: boolean
  onCredential: (credential: string) => void | Promise<void>
  onUnavailable?: (message: string) => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const callbackRef = useRef(onCredential)
  const [clientId, setClientId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => { callbackRef.current = onCredential }, [onCredential])

  useEffect(() => {
    let active = true
    api.googleConfig()
      .then((config) => {
        if (!active) return
        setEnabled(Boolean(config.enabled && config.clientId))
        setClientId(config.clientId || '')
        if (!config.enabled || !config.clientId) setStatus('error')
      })
      .catch(() => {
        if (active) { setEnabled(false); setStatus('error') }
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!enabled || !clientId || !mountRef.current) return
    let active = true
    let resizeObserver: ResizeObserver | null = null
    setStatus('loading'); setError('')

    loadGoogleScript()
      .then(() => {
        if (!active || !mountRef.current || !window.google?.accounts?.id) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => {
            const credential = String(response?.credential || '')
            if (credential) { setStatus('ready'); void callbackRef.current(credential) }
          },
        })

        const render = () => {
          if (!active || !mountRef.current || !window.google?.accounts?.id) return
          mountRef.current.replaceChildren()
          const width = Math.max(180, Math.min(400, Math.floor(mountRef.current.getBoundingClientRect().width || 360)))
          window.google.accounts.id.renderButton(mountRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: mode === 'register' ? 'signup_with' : 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width,
            locale: 'pt-BR',
          })
          setStatus('ready')
        }

        render()
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(render); resizeObserver.observe(mountRef.current) }
      })
      .catch((error) => {
        if (active) {
          const message = error instanceof Error ? error.message : 'Login com Google indisponível.'
          setError(message + ' Use e-mail e senha ou tente novamente mais tarde.')
          setStatus('error')
          onUnavailable?.(message)
        }
      })

    return () => {
      active = false
      resizeObserver?.disconnect()
      window.google?.accounts?.id?.cancel()
    }
  }, [clientId, enabled, mode, onUnavailable])

  if (!enabled) return null

  return <div className={disabled ? 'google-auth-button is-disabled' : 'google-auth-button'} aria-disabled={disabled}>
    <div ref={mountRef} className="google-auth-button__mount" />
    {status === 'loading' && <span role="status" className="google-auth-button__status">Preparando entrada com Google…</span>}
    {status === 'error' && <p role="alert" className="google-auth-button__error">{error}</p>}
    {disabled && <span role="status" className="google-auth-button__status">Autenticando com Google…</span>}
    {disabled && <span className="google-auth-button__blocker" aria-hidden="true" />}
  </div>
}
