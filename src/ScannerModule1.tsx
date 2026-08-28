import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Search, X } from 'lucide-react'
import { api } from './api'
import './scanner-module1.css'

type ImportJob = Awaited<ReturnType<typeof api.listImportJobs>>['jobs'][number]

function statusLabel(status: ImportJob['status']) {
  if (status === 'queued') return 'Aguardando scanner'
  if (status === 'scanning') return 'Escaneando'
  if (status === 'processing') return 'Organizando dados'
  if (status === 'review') return 'Pronto para revisão'
  if (status === 'completed') return 'Concluído'
  if (status === 'failed') return 'Falhou'
  return status === 'cancelled' ? 'Cancelado' : status
}

export default function ScannerModule1() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let host: HTMLElement | null = null

    const sync = () => {
      const title = Array.from(document.querySelectorAll<HTMLElement>('.panel-page .page-title'))
        .find((element) => element.querySelector('h1')?.textContent?.trim() === 'Produtos')

      if (!title) {
        if (host) host.remove()
        host = null
        setSlot(null)
        return
      }

      if (host?.isConnected && host.parentElement === title) return
      host?.remove()
      host = document.createElement('span')
      host.className = 'scanner-entry-slot'
      const primaryAction = Array.from(title.children).find((child) => child.classList.contains('primary-action'))
      if (primaryAction) title.insertBefore(host, primaryAction)
      else title.appendChild(host)
      setSlot(host)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      host?.remove()
    }
  }, [])

  const loadJobs = async () => {
    setLoadingJobs(true)
    try {
      const result = await api.listImportJobs()
      setJobs(result.jobs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as importações.')
    } finally {
      setLoadingJobs(false)
    }
  }

  const show = () => {
    setOpen(true)
    setError('')
    setSuccess('')
    void loadJobs()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await api.createImportJob(url)
      setSuccess(result.duplicated ? 'Essa loja já está na fila de importação.' : 'URL validada e importação preparada.')
      setUrl('')
      await loadJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível preparar a importação.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    {slot && createPortal(
      <button type="button" className="scanner-entry-button" onClick={show}><Search size={17} /> Importar de outra loja</button>,
      slot,
    )}
    {open && createPortal(
      <div className="scanner-modal-layer" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <button className="scanner-modal-backdrop" aria-label="Fechar" onClick={() => setOpen(false)} />
        <section className="scanner-modal">
          <header><div><span>Migração de catálogo</span><h2 id="scanner-title">Importar de outra loja</h2></div><button type="button" onClick={() => setOpen(false)}><X size={20} /></button></header>
          <form onSubmit={submit}>
            <label><span>URL da sua loja atual</span><input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" autoComplete="url" placeholder="https://minhaloja.com.br" required autoFocus /></label>
            <p className="scanner-help">Cole o endereço público da loja que pertence à sua empresa. O scanner será executado no servidor, sem expor a lógica no navegador.</p>
            {error && <p className="scanner-message scanner-message--error">{error}</p>}
            {success && <p className="scanner-message scanner-message--success"><Check size={16} /> {success}</p>}
            <button className="primary-action scanner-submit" disabled={busy}>{busy ? 'Validando…' : 'Preparar importação'}<ArrowRight size={17} /></button>
          </form>
          <div className="scanner-jobs">
            <div><strong>Importações recentes</strong><small>{loadingJobs ? 'Atualizando…' : jobs.length ? `${jobs.length} registro(s)` : 'Nenhuma ainda'}</small></div>
            {jobs.slice(0, 3).map((job) => <article key={job.id}><div><strong>{job.source_host}</strong><small>{job.source_url}</small></div><span data-status={job.status}>{statusLabel(job.status)}</span></article>)}
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>
}
