import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, PackageCheck, X } from 'lucide-react'
import './scanner-publish.css'

type Job = {
  id: string
  source_host: string
  status: string
  normalized_count: number
  selected_count: number
  warning_count: number
  duplicate_count: number
}

type PublishResult = {
  result: { selected: number; created: number; skipped_existing: number }
  idempotent: boolean
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

export default function ScannerPublishModule() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<PublishResult | null>(null)

  const readyJobs = useMemo(
    () => jobs.filter((job) => job.status === 'review' && Number(job.selected_count || 0) > 0),
    [jobs],
  )
  const readyTotal = readyJobs.reduce((sum, job) => sum + Number(job.selected_count || 0), 0)

  const load = async () => {
    try {
      const payload = await request<{ jobs: Job[] }>('/api/admin/imports')
      setJobs(payload.jobs)
    } catch {
      setJobs([])
    }
  }

  useEffect(() => {
    let host: HTMLElement | null = null
    const sync = () => {
      const title = Array.from(document.querySelectorAll<HTMLElement>('.panel-page .page-title'))
        .find((element) => element.querySelector('h1')?.textContent?.trim() === 'Produtos')
      setScannerOpen(Boolean(document.querySelector('.scanner-modal-layer')))
      if (!title) {
        host?.remove()
        host = null
        setSlot(null)
        return
      }
      if (!host?.isConnected || host.parentElement !== title) {
        host?.remove()
        host = document.createElement('span')
        host.className = 'scanner-publish-slot'
        const scannerEntry = title.querySelector('.scanner-entry-slot')
        if (scannerEntry?.nextSibling) title.insertBefore(host, scannerEntry.nextSibling)
        else title.appendChild(host)
        setSlot(host)
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); host?.remove() }
  }, [])

  useEffect(() => {
    if (!slot && !scannerOpen) return
    void load()
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [slot, scannerOpen])

  const show = () => {
    setError('')
    setSuccess(null)
    setOpen(true)
    void load()
  }

  const publish = async (job: Job) => {
    setBusyId(job.id)
    setError('')
    setSuccess(null)
    try {
      const result = await request<PublishResult>(`/api/admin/imports/${encodeURIComponent(job.id)}/publish`, {
        method: 'POST',
        body: '{}',
      })
      setSuccess(result)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível importar os produtos.')
    } finally {
      setBusyId('')
    }
  }

  const action = readyTotal > 0
    ? <button type="button" className="scanner-publish-entry" onClick={show}><PackageCheck size={17} /> Importar {readyTotal} pronto(s)</button>
    : null

  return <>
    {slot && action ? createPortal(action, slot) : null}
    {scannerOpen && action ? createPortal(<div className="scanner-publish-floating">{action}</div>, document.body) : null}

    {open && createPortal(
      <div className="scanner-publish-layer" role="dialog" aria-modal="true" aria-labelledby="scanner-publish-title">
        <button className="scanner-publish-backdrop" aria-label="Fechar" onClick={() => setOpen(false)} />
        <section className="scanner-publish-modal">
          <header>
            <div><span>Migração em massa</span><h2 id="scanner-publish-title">Importar produtos prontos</h2></div>
            <button type="button" onClick={() => setOpen(false)}><X size={20} /></button>
          </header>
          <div className="scanner-publish-content">
            <p>Os produtos tecnicamente válidos já estão selecionados. Itens que realmente precisam de correção ficam de fora e podem ser tratados depois.</p>
            {error && <div className="scanner-publish-message scanner-publish-message--error">{error}</div>}
            {success && <div className="scanner-publish-message scanner-publish-message--success"><CheckCircle2 size={17} /><div><strong>Importação concluída.</strong><span>{success.result.created} novo(s) cadastrado(s){success.result.skipped_existing ? ` · ${success.result.skipped_existing} SKU(s) já existente(s) preservado(s)` : ''}.</span></div></div>}

            <div className="scanner-publish-jobs">
              {readyJobs.length === 0 ? <div className="scanner-publish-empty">Não há importações pendentes com produtos válidos.</div> : readyJobs.map((job) => {
                const exceptions = Math.max(0, Number(job.normalized_count || 0) - Number(job.selected_count || 0))
                return <article key={job.id}>
                  <div><strong>{job.source_host}</strong><span>{job.selected_count} pronto(s) para cadastrar{exceptions ? ` · ${exceptions} exceção(ões) ficam de fora` : ''}</span></div>
                  <button type="button" disabled={Boolean(busyId)} onClick={() => void publish(job)}>{busyId === job.id ? 'Importando…' : `Importar ${job.selected_count}`}</button>
                </article>
              })}
            </div>
          </div>
          <footer>
            <span>Publicação transacional: repetir a ação não duplica produtos.</span>
            {success && <button type="button" className="scanner-publish-refresh" onClick={() => window.location.reload()}>Ver produtos cadastrados</button>}
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </>
}
