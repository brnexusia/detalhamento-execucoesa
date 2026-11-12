import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { failed: boolean }

/**
 * A chunk can become unavailable immediately after a deploy/CDN cache rotation.
 * React's Suspense doesn't catch a rejected dynamic import: without a boundary
 * it unmounts the entire SPA, leaving the user with a blank page.
 *
 * Never auto-reload: avoid loops if the origin remains unavailable.
 */
export default class AppRuntimeBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const message = String(error?.message || '')
    const kind = /import|chunk|module|load/i.test(message) ? 'module-load' : 'render'
    console.error('[shopvax-ui] screen render failed (' + kind + ')', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="svx-screen-recovery" role="alert">
        <div className="svx-screen-recovery__content">
          <strong>Não foi possível abrir esta tela.</strong>
          <p>Sua sessão e seus dados não foram alterados. Tente recarregar para abrir a versão atual do Shopvax.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Recarregar página
          </button>
        </div>
      </main>
    )
  }
}
