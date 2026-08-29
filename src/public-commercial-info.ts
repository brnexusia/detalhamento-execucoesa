type PublicCommercialConfig = {
  paymentMethods: Array<{ key: string; label: string }>
  deliveryMethods: Array<{ key: string; label: string }>
  note: string
  informationalOnly: boolean
  disclaimer: string
}

function isPublicStore() {
  const path = window.location.pathname
  if (!path || path === '/') return false
  return !path.startsWith('/painel') && !path.startsWith('/admin') && path !== '/entrar' && path !== '/criar-conta'
}

function storeSlug() {
  return window.location.pathname.split('/').filter(Boolean)[0] || ''
}

function build(config: PublicCommercialConfig) {
  document.getElementById('atacado-commercial-info')?.remove()
  const root = document.createElement('div')
  root.id = 'atacado-commercial-info'
  root.innerHTML = `
    <button class="aci-trigger" type="button">Pagamento e entrega</button>
    <div class="aci-panel" hidden>
      <div class="aci-head"><strong>Pagamento e entrega</strong><button type="button" aria-label="Fechar">×</button></div>
      <div class="aci-section"><span>Formas de pagamento</span><p>${config.paymentMethods.map((item) => item.label).join(' · ')}</p></div>
      <div class="aci-section"><span>Entrega</span><p>${config.deliveryMethods.map((item) => item.label).join(' · ')}</p></div>
      ${config.note ? `<div class="aci-note">${config.note.replace(/[<>&]/g, '')}</div>` : ''}
      <small>${config.disclaimer.replace(/[<>&]/g, '')}</small>
    </div>`
  const style = document.createElement('style')
  style.textContent = `#atacado-commercial-info{position:fixed;left:18px;bottom:18px;z-index:45;font-family:inherit}.aci-trigger{border:1px solid #d8d0c3;background:#fff;color:#171715;padding:10px 13px;box-shadow:0 8px 24px rgba(0,0,0,.13);font-weight:700;cursor:pointer}.aci-panel{position:absolute;left:0;bottom:48px;width:min(390px,calc(100vw - 36px));box-sizing:border-box;background:#fff;color:#171715;border:1px solid #d8d0c3;box-shadow:0 16px 44px rgba(0,0,0,.18);padding:16px}.aci-head{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid #eee8df;padding-bottom:10px}.aci-head button{border:0;background:transparent;font-size:25px;line-height:1;cursor:pointer}.aci-section{padding-top:12px}.aci-section span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7a7065}.aci-section p{margin:4px 0 0;line-height:1.45}.aci-note{margin-top:12px;background:#f7f3ec;padding:10px;font-size:13px;line-height:1.45}.aci-panel small{display:block;margin-top:12px;color:#756e65;line-height:1.4}@media(max-width:760px){#atacado-commercial-info{left:12px;bottom:74px}.aci-trigger{padding:9px 11px;font-size:12px}}`
  root.append(style)
  const trigger = root.querySelector<HTMLButtonElement>('.aci-trigger')!
  const panel = root.querySelector<HTMLDivElement>('.aci-panel')!
  const close = root.querySelector<HTMLButtonElement>('.aci-head button')!
  trigger.addEventListener('click', () => { panel.hidden = !panel.hidden })
  close.addEventListener('click', () => { panel.hidden = true })
  document.body.append(root)
}

async function load() {
  if (!isPublicStore()) return
  const slug = storeSlug()
  if (!slug) return
  try {
    const response = await fetch(`/api/public/commercial-config/${encodeURIComponent(slug)}`, { credentials: 'include' })
    if (!response.ok) return
    const config = await response.json() as PublicCommercialConfig
    if (config.informationalOnly) build(config)
  } catch {}
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void load(), { once: true })
  else void load()
  window.addEventListener('popstate', () => { document.getElementById('atacado-commercial-info')?.remove(); void load() })
}
