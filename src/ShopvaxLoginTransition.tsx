import { useEffect, useRef, useState } from 'react'
import ShopvaxLoading from './ShopvaxLoading'

const LOGIN_MOTION_DURATION_MS = 1_450

/** A vinheta pertence ao App, e NÃO à rota /entrar.
 * Assim, trocar a rota ou carregar o bootstrap do painel não desmonta o fundo
 * preto antes do destino estar pronto — elimina o flash bege intermediário.
 */
function isDestinationReady(path: string): boolean {
  if (path.startsWith('/painel')) {
    return Boolean(document.querySelector('.panel-shell, .panel-loading--error'))
  }
  if (path.startsWith('/admin/lancamento')) {
    return Boolean(document.querySelector('.launchops-shell, .launchops-error'))
  }
  if (path.startsWith('/admin')) {
    return Boolean(document.querySelector('.platform-shell, .platform-loading--error'))
  }
  if (path.startsWith('/cliente')) {
    return Boolean(document.querySelector('.customer-page')) &&
      !document.querySelector('.customer-loading')
  }
  if (path === '/entrar' || path === '/criar-conta') {
    return Boolean(document.querySelector('.auth-shell'))
  }
  if (path === '/para-lojas') return Boolean(document.querySelector('.home-shell'))
  if (path === '/' || path === '/feed' || path === '/descobrir') {
    return Boolean(document.querySelector('.social-feed-nav'))
  }
  if (path.startsWith('/perfil')) return Boolean(document.querySelector('.social-profile-page'))
  return Boolean(document.querySelector('.app'))
}

export default function ShopvaxLoginTransition() {
  const [stage, setStage] = useState<'idle' | 'cover' | 'revealing'>('idle')
  const startedAt = useRef(0)
  const originPath = useRef('')

  useEffect(() => {
    const onStart = () => {
      originPath.current = window.location.pathname
      startedAt.current = performance.now()
      setStage('cover')
    }
    window.addEventListener('shopvax:login-transition-start', onStart)
    return () => window.removeEventListener('shopvax:login-transition-start', onStart)
  }, [])

  useEffect(() => {
    if (stage !== 'cover') return
    let finished = false
    let nextFrame = 0
    let revealFrame = 0
    const finish = () => {
      if (finished) return
      finished = true
      // Só começa a revelar após o destino ter sido montado e pintado.
      nextFrame = requestAnimationFrame(() => {
        revealFrame = requestAnimationFrame(() => setStage('revealing'))
      })
    }
    const check = () => {
      if (finished || performance.now() - startedAt.current < LOGIN_MOTION_DURATION_MS) return
      const path = window.location.pathname
      if (path === originPath.current) return
      if (isDestinationReady(path)) finish()
    }
    const observer = new MutationObserver(check)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
    window.addEventListener('popstate', check)
    const polling = window.setInterval(check, 70)
    // Uma falha de rede nunca pode prender o usuário atrás da vinheta para sempre.
    const safety = window.setTimeout(finish, 15_000)
    check()
    return () => {
      observer.disconnect()
      window.removeEventListener('popstate', check)
      window.clearInterval(polling)
      window.clearTimeout(safety)
      cancelAnimationFrame(nextFrame)
      cancelAnimationFrame(revealFrame)
    }
  }, [stage])

  useEffect(() => {
    if (stage !== 'revealing') return
    const timeout = window.setTimeout(() => setStage('idle'), 170)
    return () => window.clearTimeout(timeout)
  }, [stage])

  if (stage === 'idle') return null

  return <div className={'svx-auth-loading-overlay svx-auth-login-bridge' +
    (stage === 'revealing' ? ' is-revealing' : '')} data-testid="shopvax-login-bridge">
    <ShopvaxLoading immediate dark exit repeat={false} label="Acesso confirmado. Abrindo sua loja…" />
  </div>
}
