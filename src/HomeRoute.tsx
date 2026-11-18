import { useEffect } from 'react'

// Fallback para navegações SPA: a versão original é um documento separado.
// Navegações diretas são atendidas por /para-lojas no Express.
export default function HomeRoute() {
  useEffect(() => { window.location.replace('/para-lojas') }, [])
  return null
}
