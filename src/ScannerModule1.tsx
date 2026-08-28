import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Search,
  X,
} from 'lucide-react'
import { api, type ImportJob, type ImportReviewData, type ImportReviewProduct, type ImportReviewSummary } from './api'
import './scanner-module1.css'

function statusLabel(status: ImportJob['status']) {
  if (status === 'queued') return 'Aguardando scanner'
  if (status === 'scanning') return 'Escaneando'
  if (status === 'processing') return 'Organizando produtos'
  if (status === 'review') return 'Pronto para revisão'
  if (status === 'completed') return 'Concluído'
  if (status === 'failed') return 'Falhou'
  return status === 'cancelled' ? 'Cancelado' : status
}

function platformLabel(value: string) {
  if (!value || value === 'generic') return 'Site próprio'
  if (value === 'shopify') return 'Shopify'
  if (value === 'woocommerce') return 'WooCommerce'
  if (value === 'nuvemshop') return 'Nuvemshop'
  if (value === 'lojaintegrada') return 'Loja Integrada'
  if (value === 'tray') return 'Tray'
  return value
}

function jobDetails(job: ImportJob) {
  if (job.status === 'review') {
    const alerts = job.warning_count ? ` · ${job.warning_count} para conferir` : ''
    const duplicates = job.duplicate_count ? ` · ${job.duplicate_count} duplicado(s) removido(s)` : ''
    return `${platformLabel(job.platform)} · ${job.normalized_count} encontrado(s)${alerts}${duplicates}`
  }
  return `${job.platform ? `${platformLabel(job.platform)} · ` : ''}${job.result_count} produto(s) · ${job.pages_scanned} página(s)`
}

const warningLabels: Record<string, string> = {
  missing_name: 'Sem nome',
  missing_price: 'Sem preço',
  missing_image: 'Sem imagem',
  missing_sku: 'Sem SKU',
  missing_category: 'Sem categoria',
  missing_description: 'Sem descrição',
}

function cloneReviewData(data: ImportReviewData): ImportReviewData {
  return {
    ...data,
    images: [...(data.images || [])],
    variations: (data.variations || []).map((group) => ({ name: group.name, options: [...group.options] })),
  }
}

export default function ScannerModule1() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'scan' | 'review'>('scan')
  const [url, setUrl] = useState('')
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [reviewJob, setReviewJob] = useState<ImportJob | null>(null)
  const [reviewProducts, setReviewProducts] = useState<ImportReviewProduct[]>([])
  const [reviewSummary, setReviewSummary] = useState<ImportReviewSummary | null>(null)
  const [reviewFilter, setReviewFilter] = useState<'all' | 'alerts' | 'selected'>('all')
  const [reviewQuery, setReviewQuery] = useState('')
  const [reviewPagination, setReviewPagination] = useState({ limit: 40, offset: 0, total: 0 })
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [selectionBusy, setSelectionBusy] = useState(false)

  const [editing, setEditing] = useState<ImportReviewProduct | null>(null)
  const [draft, setDraft] = useState<ImportReviewData | null>(null)
  const [editorSelected, setEditorSelected] = useState(false)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState('')

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
    return () => { observer.disconnect(); host?.remove() }
  }, [])

  const loadJobs = async (quiet = false) => {
    if (!quiet) setLoadingJobs(true)
    try {
      const result = await api.listImportJobs()
      setJobs(result.jobs)
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : 'Não foi possível carregar as importações.')
    } finally {
      if (!quiet) setLoadingJobs(false)
    }
  }

  const loadReview = async (
    jobId: string,
    options: { offset?: number; filter?: 'all' | 'alerts' | 'selected'; q?: string } = {},
  ) => {
    setReviewLoading(true)
    setReviewError('')
    try {
      const result = await api.reviewImportProducts(jobId, {
        limit: reviewPagination.limit,
        offset: options.offset ?? reviewPagination.offset,
        filter: options.filter ?? reviewFilter,
        q: options.q ?? reviewQuery,
      })
      setReviewJob(result.job)
      setReviewProducts(result.products)
      setReviewSummary(result.summary)
      setReviewPagination(result.pagination)
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Não foi possível carregar a revisão.')
    } finally {
      setReviewLoading(false)
    }
  }

  useEffect(() => {
    if (!open || mode !== 'scan') return
    const timer = window.setInterval(() => {
      if (jobs.some((job) => ['queued', 'scanning', 'processing'].includes(job.status))) void loadJobs(true)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [open, mode, jobs])

  useEffect(() => {
    if (!open || mode !== 'review' || !reviewJob) return
    const timer = window.setTimeout(() => {
      void loadReview(reviewJob.id, { offset: 0, filter: reviewFilter, q: reviewQuery })
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewFilter, reviewQuery])

  const show = () => {
    setOpen(true)
    setMode('scan')
    setError('')
    setSuccess('')
    setReviewJob(null)
    setEditing(null)
    void loadJobs()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await api.createImportJob(url)
      setSuccess(result.duplicated ? 'Essa loja já está sendo processada.' : 'Scanner iniciado. Você pode acompanhar o progresso abaixo.')
      setUrl('')
      await loadJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o scanner.')
    } finally {
      setBusy(false)
    }
  }

  const openReview = async (job: ImportJob) => {
    setMode('review')
    setReviewJob(job)
    setReviewFilter('all')
    setReviewQuery('')
    setReviewPagination((current) => ({ ...current, offset: 0, total: job.normalized_count }))
    await loadReview(job.id, { offset: 0, filter: 'all', q: '' })
  }

  const backToImports = () => {
    setMode('scan')
    setReviewJob(null)
    setReviewProducts([])
    setReviewSummary(null)
    setEditing(null)
    void loadJobs()
  }

  const toggleProduct = async (product: ImportReviewProduct) => {
    if (!reviewJob) return
    setReviewError('')
    try {
      const result = await api.updateImportReviewProduct(reviewJob.id, product.id, { selected: !product.selected })
      setReviewProducts((current) => current.map((item) => item.id === product.id ? result.product : item))
      setReviewSummary(result.summary)
      setReviewJob(result.job)
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Não foi possível alterar a seleção.')
    }
  }

  const bulkSelection = async (action: 'ready' | 'none') => {
    if (!reviewJob) return
    setSelectionBusy(true)
    setReviewError('')
    try {
      const result = await api.updateImportReviewSelection(reviewJob.id, action)
      setReviewSummary(result.summary)
      setReviewJob(result.job)
      await loadReview(reviewJob.id, { offset: reviewPagination.offset })
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Não foi possível alterar a seleção.')
    } finally {
      setSelectionBusy(false)
    }
  }

  const startEdit = (product: ImportReviewProduct) => {
    setEditing(product)
    setDraft(cloneReviewData(product.data))
    setEditorSelected(product.selected)
    setEditorError('')
  }

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reviewJob || !editing || !draft) return
    setEditorBusy(true)
    setEditorError('')
    try {
      const result = await api.updateImportReviewProduct(reviewJob.id, editing.id, { data: draft, selected: editorSelected })
      setReviewSummary(result.summary)
      setReviewJob(result.job)
      setEditing(null)
      setDraft(null)
      await loadReview(reviewJob.id, { offset: reviewPagination.offset })
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Não foi possível salvar a revisão.')
    } finally {
      setEditorBusy(false)
    }
  }

  const updateDraft = <K extends keyof ImportReviewData>(key: K, value: ImportReviewData[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  const updateVariation = (index: number, field: 'name' | 'options', value: string) => {
    if (!draft) return
    const variations = draft.variations.map((group, groupIndex) => {
      if (groupIndex !== index) return group
      return field === 'name'
        ? { ...group, name: value }
        : { ...group, options: value.split(',').map((option) => option.trim()).filter(Boolean) }
    })
    updateDraft('variations', variations)
  }

  const addVariation = () => {
    if (!draft || draft.variations.length >= 5) return
    updateDraft('variations', [...draft.variations, { name: '', options: [] }])
  }

  const removeVariation = (index: number) => {
    if (!draft) return
    updateDraft('variations', draft.variations.filter((_group, groupIndex) => groupIndex !== index))
  }

  const reviewStart = reviewPagination.total ? reviewPagination.offset + 1 : 0
  const reviewEnd = Math.min(reviewPagination.offset + reviewPagination.limit, reviewPagination.total)

  return <>
    {slot && createPortal(
      <button type="button" className="scanner-entry-button" onClick={show}><Search size={17} /> Importar de outra loja</button>,
      slot,
    )}

    {open && createPortal(
      <div className="scanner-modal-layer" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <button className="scanner-modal-backdrop" aria-label="Fechar" onClick={() => setOpen(false)} />

        {mode === 'scan' ? <section className="scanner-modal">
          <header>
            <div><span>Migração de catálogo</span><h2 id="scanner-title">Importar de outra loja</h2></div>
            <button type="button" onClick={() => setOpen(false)}><X size={20} /></button>
          </header>
          <form onSubmit={submit}>
            <label><span>URL da sua loja atual</span><input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" autoComplete="url" placeholder="https://minhaloja.com.br" required autoFocus /></label>
            <p className="scanner-help">Cole o endereço público da loja que pertence à sua empresa. A coleta e a organização acontecem no servidor e não publicam nenhum produto sem revisão.</p>
            {error && <p className="scanner-message scanner-message--error">{error}</p>}
            {success && <p className="scanner-message scanner-message--success"><Check size={16} /> {success}</p>}
            <button className="primary-action scanner-submit" disabled={busy}>{busy ? 'Iniciando…' : 'Escanear loja'}<ArrowRight size={17} /></button>
          </form>
          <div className="scanner-jobs">
            <div><strong>Importações recentes</strong><small>{loadingJobs ? 'Atualizando…' : jobs.length ? `${jobs.length} registro(s)` : 'Nenhuma ainda'}</small></div>
            {jobs.slice(0, 5).map((job) => <article key={job.id}>
              <div><strong>{job.source_host}</strong><small>{jobDetails(job)}</small>{job.status === 'failed' && job.error && <small className="scanner-job-error">{job.error}</small>}</div>
              <div className="scanner-job-actions">
                {job.status === 'review' && <button type="button" className="scanner-review-open" onClick={() => void openReview(job)}>Revisar</button>}
                <span data-status={job.status}>{job.status === 'scanning' || job.status === 'processing' ? `${statusLabel(job.status)} ${job.progress}%` : statusLabel(job.status)}</span>
              </div>
            </article>)}
          </div>
        </section> : <section className="scanner-modal scanner-modal--review">
          <header>
            <div className="scanner-review-heading">
              <button type="button" className="scanner-back" onClick={backToImports}><ArrowLeft size={17} /> Importações</button>
              <div><span>Revisão do catálogo</span><h2 id="scanner-title">{reviewJob?.source_host}</h2></div>
            </div>
            <button type="button" onClick={() => setOpen(false)}><X size={20} /></button>
          </header>

          <div className="scanner-review-body">
            <div className="scanner-review-summary">
              <div><small>Encontrados</small><strong>{reviewSummary?.total_count ?? reviewJob?.normalized_count ?? 0}</strong></div>
              <div><small>Sem alertas</small><strong>{reviewSummary?.ready_count ?? 0}</strong></div>
              <div data-alert={(reviewSummary?.warning_count ?? 0) > 0}><small>Para conferir</small><strong>{reviewSummary?.warning_count ?? 0}</strong></div>
              <div><small>Selecionados</small><strong>{reviewSummary?.selected_count ?? reviewJob?.selected_count ?? 0}</strong></div>
            </div>

            <div className="scanner-review-toolbar">
              <label className="scanner-review-search"><Search size={16} /><input value={reviewQuery} onChange={(event) => setReviewQuery(event.target.value)} placeholder="Buscar nome, SKU ou categoria" /></label>
              <div className="scanner-review-filters">
                <button type="button" data-active={reviewFilter === 'all'} onClick={() => setReviewFilter('all')}>Todos</button>
                <button type="button" data-active={reviewFilter === 'alerts'} onClick={() => setReviewFilter('alerts')}>Com alerta</button>
                <button type="button" data-active={reviewFilter === 'selected'} onClick={() => setReviewFilter('selected')}>Selecionados</button>
              </div>
              <div className="scanner-review-bulk">
                <button type="button" disabled={selectionBusy} onClick={() => void bulkSelection('ready')}><CheckCircle2 size={15} /> Selecionar sem alertas</button>
                <button type="button" disabled={selectionBusy} onClick={() => void bulkSelection('none')}>Limpar seleção</button>
              </div>
            </div>

            {reviewError && <p className="scanner-message scanner-message--error scanner-review-error">{reviewError}</p>}

            <div className="scanner-review-list" aria-busy={reviewLoading}>
              {reviewLoading && !reviewProducts.length ? <div className="scanner-review-empty">Carregando produtos…</div> : null}
              {!reviewLoading && !reviewProducts.length ? <div className="scanner-review-empty">Nenhum produto encontrado neste filtro.</div> : null}
              {reviewProducts.map((product) => {
                const image = product.data.media_url || product.data.images?.[0] || ''
                return <article key={product.id} className="scanner-review-product" data-selected={product.selected}>
                  <label className="scanner-review-check" title={product.selected ? 'Remover da importação' : 'Selecionar para importação'}>
                    <input type="checkbox" checked={product.selected} onChange={() => void toggleProduct(product)} />
                    <span><Check size={13} /></span>
                  </label>
                  <div className="scanner-review-thumb">{image ? <img src={image} alt="" loading="lazy" /> : <span>Sem foto</span>}</div>
                  <div className="scanner-review-product-copy">
                    <div><strong>{product.data.name || 'Produto sem nome'}</strong>{product.edited && <em>Editado</em>}</div>
                    <small>{product.data.sku || 'Sem SKU'} · {product.data.category || 'Sem categoria'}</small>
                    <b>{product.data.price != null ? product.data.price.toLocaleString('pt-BR', { style: 'currency', currency: product.data.currency || 'BRL' }) : 'Preço não encontrado'}</b>
                    {product.warnings.length > 0 ? <div className="scanner-review-warnings">{product.warnings.map((warning) => <span key={warning}><AlertTriangle size={11} /> {warningLabels[warning] || warning}</span>)}</div> : <div className="scanner-review-ready"><CheckCircle2 size={12} /> Pronto para importar</div>}
                  </div>
                  <button type="button" className="scanner-review-edit" onClick={() => startEdit(product)}><Edit3 size={15} /> Editar</button>
                </article>
              })}
            </div>

            <div className="scanner-review-footer">
              <small>{reviewStart}–{reviewEnd} de {reviewPagination.total}</small>
              <div>
                <button type="button" disabled={reviewLoading || reviewPagination.offset === 0} onClick={() => reviewJob && void loadReview(reviewJob.id, { offset: Math.max(0, reviewPagination.offset - reviewPagination.limit) })}><ChevronLeft size={16} /> Anterior</button>
                <button type="button" disabled={reviewLoading || reviewPagination.offset + reviewPagination.limit >= reviewPagination.total} onClick={() => reviewJob && void loadReview(reviewJob.id, { offset: reviewPagination.offset + reviewPagination.limit })}>Próxima <ChevronRight size={16} /></button>
              </div>
              <p>Nesta etapa nada é publicado na loja. A seleção fica salva para a próxima fase da importação.</p>
            </div>
          </div>
        </section>}
      </div>,
      document.body,
    )}

    {editing && draft && createPortal(
      <div className="scanner-editor-layer" role="dialog" aria-modal="true" aria-labelledby="scanner-editor-title">
        <button type="button" className="scanner-editor-backdrop" aria-label="Fechar editor" onClick={() => setEditing(null)} />
        <form className="scanner-editor" onSubmit={saveEdit}>
          <header><div><span>Revisar produto</span><h3 id="scanner-editor-title">{editing.data.name || 'Produto sem nome'}</h3></div><button type="button" onClick={() => setEditing(null)}><X size={20} /></button></header>
          <div className="scanner-editor-fields">
            <label className="scanner-field-wide"><span>Nome</span><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} /></label>
            <label><span>Preço</span><input type="number" min="0" step="0.01" value={draft.price ?? ''} onChange={(event) => updateDraft('price', event.target.value === '' ? null : Number(event.target.value))} /></label>
            <label><span>Moeda</span><input value={draft.currency} maxLength={10} onChange={(event) => updateDraft('currency', event.target.value)} placeholder="BRL" /></label>
            <label><span>SKU</span><input value={draft.sku} onChange={(event) => updateDraft('sku', event.target.value)} /></label>
            <label><span>Categoria</span><input value={draft.category} onChange={(event) => updateDraft('category', event.target.value)} /></label>
            <label><span>Marca</span><input value={draft.brand} onChange={(event) => updateDraft('brand', event.target.value)} /></label>
            <label><span>Embalagem / grade</span><input value={draft.pack} onChange={(event) => updateDraft('pack', event.target.value)} /></label>
            <label className="scanner-field-wide"><span>Descrição</span><textarea rows={4} value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} /></label>
            <label className="scanner-field-wide"><span>Imagens · uma URL por linha</span><textarea rows={3} value={draft.images.join('\n')} onChange={(event) => updateDraft('images', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>

            <div className="scanner-variation-editor scanner-field-wide">
              <div><span>Variações</span>{draft.variations.length < 5 && <button type="button" onClick={addVariation}>+ Adicionar variação</button>}</div>
              {draft.variations.length === 0 && <small>Nenhuma variação encontrada.</small>}
              {draft.variations.map((group, index) => <div className="scanner-variation-row" key={`${index}-${group.name}`}>
                <input aria-label="Nome da variação" placeholder="Ex.: Cor" value={group.name} onChange={(event) => updateVariation(index, 'name', event.target.value)} />
                <input aria-label="Opções da variação" placeholder="Preto, Branco, Azul" value={group.options.join(', ')} onChange={(event) => updateVariation(index, 'options', event.target.value)} />
                <button type="button" aria-label="Remover variação" onClick={() => removeVariation(index)}><X size={15} /></button>
              </div>)}
            </div>

            <label className="scanner-editor-select scanner-field-wide"><input type="checkbox" checked={editorSelected} onChange={(event) => setEditorSelected(event.target.checked)} /><span>Selecionar este produto para a importação</span></label>
            {editorError && <p className="scanner-message scanner-message--error scanner-field-wide">{editorError}</p>}
          </div>
          <footer><button type="button" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="primary-action" disabled={editorBusy}>{editorBusy ? 'Salvando…' : 'Salvar revisão'}</button></footer>
        </form>
      </div>,
      document.body,
    )}
  </>
}
