import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react'
import './ui-state.css'

type Props = {
  title: string
  message?: string
  loading?: boolean
  onRetry?: () => void
  actionLabel?: string
  compact?: boolean
}

export default function UiState({ title, message, loading = false, onRetry, actionLabel = 'Tentar novamente', compact = false }: Props) {
  return <div className={compact ? 'ui-state ui-state--compact' : 'ui-state'} role={loading ? 'status' : 'alert'} aria-live="polite">
    {loading ? <LoaderCircle className="ui-state__spin" size={26}/> : <AlertCircle size={26}/>}
    <strong>{title}</strong>
    {message && <p>{message}</p>}
    {!loading && onRetry && <button type="button" onClick={onRetry}><RefreshCw size={15}/>{actionLabel}</button>}
  </div>
}
