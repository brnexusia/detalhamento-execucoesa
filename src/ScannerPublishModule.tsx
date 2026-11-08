import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, PackageCheck, X } from 'lucide-react'
import './scanner-publish.css'

type Job = {
  id: string
  source_host: string
  platform: string
  status: string
  normalized_count: number
  selected_count: number
  warning_count: number
  duplicate_count: number
}

type PdfMode = 'separate' | 'grouped'
type PublishPreview = {
  mode: PdfMode
  selected_count: number
  publication_count: number
  grouped_count: number
  examples: Array<{ name: string; occurrences: number }>
}
type PublishResult = {
  result: { selected: number; created: number; skipped_existing: number }
  idempotent: boolean
}
type PublishProgress = {
  jobId: string
  state: 'queued' | 'running' | 'finished' | 'failed'
  phase: string
  message: string
  completed: number
  total: number
  percent: number
  error: string
  result: PublishResult | null
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
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [pollCount, setPollCount] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<PublishResult | null>(null)
  const [modes, setModes] = useState<Record<string, PdfMode>>({})
  const [previews, setPreviews] = useState<Record<string, PublishPreview | undefined>>({})
  const [publishProgress, setPublishProgress] = useState<Record<string,PublishProgress>>({})
  const handledCompletion = useRef(new Set<string>())


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
      // Scanner visibility is delivered by an explicit event, not a global DOM rescan.
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
    const onScannerVisibility = (event: Event) => {
      setScannerOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open))
    }
    const onScannerJobs = (event: Event) => {
      const next = (event as CustomEvent<{ jobs: Job[] }>).detail?.jobs
      if (Array.isArray(next)) setJobs(next)
    }
    window.addEventListener('shopvax:products-ready', sync)
    window.addEventListener('shopvax:scanner-visibility', onScannerVisibility)
    window.addEventListener('shopvax:scanner-jobs-changed', onScannerJobs)
    return () => {
      window.removeEventListener('shopvax:products-ready', sync)
      window.removeEventListener('shopvax:scanner-visibility', onScannerVisibility)
      window.removeEventListener('shopvax:scanner-jobs-changed', onScannerJobs)
      host?.remove()
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!slot && !scannerOpen) return
    void load()
  }, [slot, scannerOpen])

  useEffect(() => {
    // When the scanner is open, its own job snapshots drive this button.
    if (!slot || scannerOpen || !visible || !jobs.some((job) => ['queued', 'scanning', 'processing'].includes(job.status))) return
    const delay = Math.min(30_000, 3_500 * Math.pow(1.5, Math.min(pollCount, 7)))
    const timer = window.setTimeout(() => {
      void load()
      setPollCount((value) => value + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [slot, scannerOpen, visible, jobs, pollCount])

  const loadPublishProgress = async (jobId: string) => {
    try {
      const payload = await request<{ progress: PublishProgress | null }>(
        `/api/admin/imports/${encodeURIComponent(jobId)}/publish-progress`,
      )
      if (!payload.progress) return
      const progress=payload.progress
      setPublishProgress(current=>({...current,[jobId]:progress}))
      if(progress.state==='finished' && progress.result && !handledCompletion.current.has(jobId)){
        handledCompletion.current.add(jobId)
        setSuccess(progress.result)
        window.dispatchEvent(new Event('shopvax:catalog-changed'))
        await load()
      }
    } catch {
      // The task continues on the server when a phone/network temporarily drops.
    }
  }

  useEffect(()=>{
    if(!open)return
    const poll=()=>{
      for(const job of readyJobs) void loadPublishProgress(job.id)
    }
    poll()
    const timer=window.setInterval(poll,1600)
    return ()=>window.clearInterval(timer)
  },[open,readyJobs])

  const loadPreview = async (job: Job, mode: PdfMode) => {
    setPreviews((current) => ({ ...current, [job.id]: undefined }))
    try {
      const payload = await request<{ preview: PublishPreview }>(
        `/api/admin/imports/${encodeURIComponent(job.id)}/publish-preview?mode=${mode}`,
      )
      setPreviews((current) => ({ ...current, [job.id]: payload.preview }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível calcular a prévia.')
    }
  }

  useEffect(() => {
    if (!open) return
    for (const job of readyJobs) {
      if (job.platform === 'pdf') void loadPreview(job, modes[job.id] || 'separate')
    }
  }, [open, readyJobs])

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
      const payload = await request<{progress:PublishProgress}>(
        `/api/admin/imports/${encodeURIComponent(job.id)}/publish-async`,{
          method:'POST',
          body:JSON.stringify({mode:job.platform==='pdf' ? (modes[job.id]||'separate') : 'grouped'}),
        })
      setPublishProgress(current=>({...current,[job.id]:payload.progress}))
      // Progress and final result are retrieved independently of this request.
      void loadPublishProgress(job.id)
    } catch(err) {
      setError(err instanceof Error?err.message:'Não foi possível iniciar a publicação.')
    } finally {setBusyId('')}
  }

  const action = readyTotal > 0
    ? <button type="button" className="scanner-publish-entry" onClick={show}><PackageCheck size={17} /> Ver {readyTotal} produto(s) de {readyJobs.length} importação(ões)</button>
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
            <p>Este painel reúne <strong>{readyTotal} produtos de {readyJobs.length} importação(ões) pendente(s)</strong>. Os totais são somados entre catálogos diferentes. Use o botão de cada catálogo abaixo para publicar apenas aquela importação; abrir este painel não publica todos.</p>
            <p>Os produtos tecnicamente válidos já estão selecionados. Itens que realmente precisam de correção ficam de fora e podem ser tratados depois.</p>
            {error && <div className="scanner-publish-message scanner-publish-message--error">{error}</div>}
            {success && <div className="scanner-publish-message scanner-publish-message--success"><CheckCircle2 size={17} /><div><strong>Importação concluída.</strong><span>{success.result.created} novo(s) cadastrado(s){success.result.skipped_existing ? ` · ${success.result.skipped_existing} SKU(s) já existente(s) preservado(s)` : ''}.</span></div></div>}

            <div className="scanner-publish-jobs">
              {readyJobs.length === 0 ? <div className="scanner-publish-empty">Não há importações pendentes com produtos válidos.</div> : readyJobs.map((job) => {
                const exceptions = Math.max(0, Number(job.normalized_count || 0) - Number(job.selected_count || 0))
                return <article key={job.id}>
                  <div>
                    <strong>{job.source_host}</strong>
                    <span>{job.selected_count} selecionado(s){exceptions ? ` · ${exceptions} exceção(ões) ficam de fora` : ''}</span>
                    {job.platform === 'pdf' && <>
                      <label className="scanner-publish-mode">
                        <span>Como cadastrar este PDF</span>
                        <select value={modes[job.id] || 'separate'} disabled={Boolean(busyId)} onChange={(event) => {
                          const mode = event.target.value as PdfMode
                          setModes((current) => ({ ...current, [job.id]: mode }))
                          void loadPreview(job, mode)
                        }}>
                          <option value="separate">Cada ocorrência como produto (recomendado)</option>
                          <option value="grouped">Agrupar modelos iguais</option>
                        </select>
                      </label>
                      {previews[job.id]?.mode === (modes[job.id] || 'separate') ?
                        <span>Prévia: {previews[job.id]?.selected_count} selecionados → {previews[job.id]?.publication_count} produtos; {previews[job.id]?.grouped_count} ocorrência(s) agrupada(s).</span>
                        : <span>Calculando prévia…</span>}
                      {previews[job.id]?.mode === 'grouped' && previews[job.id]?.examples.length ?
                        <small>Exemplos: {previews[job.id]?.examples.map((group) => `${group.name} (${group.occurrences}x)`).join(' · ')}</small> : null}
                    </>}
                  </div>
                  <div className="scanner-publish-actions">
                    {publishProgress[job.id] && ['queued','running'].includes(publishProgress[job.id].state) && (
                      <div className="scanner-publish-progress" role="status" aria-live="polite">
                        <div className="scanner-publish-progress-label">
                          <strong>{publishProgress[job.id].message}</strong>
                          <b>{publishProgress[job.id].percent}%</b>
                        </div>
                        <div className="scanner-publish-track" role="progressbar"
                          aria-label="Progresso da publicação"
                          aria-valuenow={publishProgress[job.id].percent} aria-valuemin={0} aria-valuemax={100}>
                          <span style={{width:`${publishProgress[job.id].percent}%`}}/>
                        </div>
                        <small>{publishProgress[job.id].total>0
                          ? `${publishProgress[job.id].completed} de ${publishProgress[job.id].total} nesta etapa`
                          : 'Preparando a próxima etapa…'} · Pode fechar esta janela</small>
                      </div>
                    )}
                    {publishProgress[job.id]?.state==='failed' && (
                      <small className="scanner-publish-progress-error">
                        {publishProgress[job.id].error} · Você pode tentar novamente.
                      </small>
                    )}
                    <button type="button"
                      disabled={Boolean(busyId) ||
                        ['queued','running'].includes(publishProgress[job.id]?.state||'') ||
                        (job.platform === 'pdf' && previews[job.id]?.mode !== (modes[job.id] || 'separate'))}
                      onClick={() => void publish(job)}>
                      {busyId === job.id ? 'Iniciando…' :
                        ['queued','running'].includes(publishProgress[job.id]?.state||'') ? 'Importação em andamento' :
                        `Importar ${job.platform === 'pdf' ? (previews[job.id]?.publication_count ?? '…') : job.selected_count}`}
                    </button>
                  </div>
                </article>
              })}
            </div>
          </div>
          <footer>
            <span>Progresso salvo no servidor. Você pode sair e voltar; a publicação é transacional.</span>
            {success && <button type="button" className="scanner-publish-refresh" onClick={() => window.location.reload()}>Ver produtos cadastrados</button>}
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </>
}
