type DialogOptions = {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  secret?: boolean
}

function openDialog(options: DialogOptions): Promise<string | boolean> {
  return new Promise((resolve) => {
    const layer = document.createElement('div')
    layer.className = 'shopvax-dialog-layer'
    const card = document.createElement('section')
    card.className = 'shopvax-dialog'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')

    const title = document.createElement('h2')
    title.textContent = options.title
    const copy = document.createElement('p')
    copy.textContent = options.message
    card.append(title, copy)

    let input: HTMLInputElement | null = null
    if (options.secret) {
      input = document.createElement('input')
      input.type = 'password'
      input.autocomplete = 'current-password'
      input.placeholder = 'Sua senha'
      input.setAttribute('aria-label', 'Sua senha')
      card.append(input)
    }

    const actions = document.createElement('div')
    actions.className = 'shopvax-dialog__actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancelar'
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.textContent = options.confirmLabel || 'Confirmar'
    confirm.className = options.danger ? 'is-danger' : 'is-primary'
    actions.append(cancel, confirm)
    card.append(actions)
    layer.append(card)
    document.body.append(layer)

    const close = (value: string | boolean) => {
      document.removeEventListener('keydown', onKey)
      layer.remove()
      resolve(value)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(options.secret ? '' : false)
      if (event.key === 'Enter' && options.secret && input?.value) close(input.value)
    }

    cancel.addEventListener('click', () => close(options.secret ? '' : false))
    layer.addEventListener('click', (event) => { if (event.target === layer) close(options.secret ? '' : false) })
    confirm.addEventListener('click', () => {
      if (options.secret) {
        if (!input?.value) { input?.focus(); return }
        close(input.value)
      } else close(true)
    })
    document.addEventListener('keydown', onKey)
    window.setTimeout(() => (input || cancel).focus(), 0)
  })
}

export async function confirmAction(message: string, title = 'Confirmar ação', confirmLabel = 'Confirmar') {
  return Boolean(await openDialog({ title, message, confirmLabel, danger: true }))
}

export async function promptSecret(message: string, title = 'Confirme sua identidade') {
  const value = await openDialog({ title, message, confirmLabel: 'Continuar', secret: true })
  return typeof value === 'string' ? value : ''
}


export function showToast(message: string, kind: 'info' | 'error' = 'info') {
  const toast = document.createElement('div')
  toast.className = `shopvax-global-toast ${kind === 'error' ? 'is-error' : ''}`
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  toast.textContent = message
  document.body.append(toast)
  window.setTimeout(() => toast.remove(), 3200)
}
