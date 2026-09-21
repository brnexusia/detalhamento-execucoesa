import { useEffect, useRef } from 'react'
import { confirmAction } from './ui-dialogs'

const dirtySources = new Set<symbol>()

export function useUnsavedChanges(dirty: boolean) {
  const id = useRef(Symbol('shopvax-unsaved'))

  useEffect(() => {
    if (dirty) dirtySources.add(id.current)
    else dirtySources.delete(id.current)
    return () => { dirtySources.delete(id.current) }
  }, [dirty])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtySources.size) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])
}

export function hasUnsavedChanges() {
  return dirtySources.size > 0
}

export async function confirmNavigationIfDirty() {
  if (!hasUnsavedChanges()) return true
  return confirmAction('Há alterações ainda não salvas nesta tela. Deseja sair sem salvar?', 'Descartar alterações', 'Sair sem salvar')
}
