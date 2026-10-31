import { useEffect, useState } from 'react'
import { ArrowRight, Check, ExternalLink, HelpCircle, RotateCcw } from 'lucide-react'
import { apiRequest } from './api'
import type { AdminBootstrap } from './types'
import './shopvax-growth.css'

type Section = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'loja' | 'temas'
type Progress = { identity: boolean; sellers: boolean; products: boolean; minimumOrder: number; confirmed: string[] }
type Step = { key: string; title: string; description: string; completed: boolean; section?: Section; confirmation?: string }

export default function ShopvaxOnboardingGuide({ data, storeUrl, onSection }: {
  data: AdminBootstrap
  storeUrl: string
  onSection: (section: Section) => void
}) {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState<string[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const reload = async () => {
    try { setProgress(await apiRequest<Progress>('/api/admin/growth/onboarding')) }
    catch { setError('Não foi possível consultar o progresso. Suas etapas não serão marcadas como concluídas.') }
  }
  useEffect(() => { void reload(); setSkipped([]); setActiveKey('') }, [data.store.id, data.products.length, data.sellers.length, data.store.accent, data.store.minimum_order])
  const confirmed = progress?.confirmed || []
  const steps: Step[] = [
    { key: 'identity', title: 'Identidade da loja', description: 'Escolha a cor da vitrine e confira o nome e a identidade da loja em Temas e paletas.', completed: progress?.identity === true, section: 'temas' },
    { key: 'sellers', title: 'Primeira vendedora', description: 'Cadastre uma vendedora com telefone válido e mantenha o perfil ativo. O número administrativo da loja não recebe pedidos.', completed: progress?.sellers === true, section: 'vendedoras' },
    { key: 'products', title: 'Primeiros produtos', description: 'Cadastre ou importe produtos e revise seus dados antes de publicar.', completed: progress?.products === true, section: 'produtos' },
    { key: 'minimum_reviewed', title: 'Catálogo e pedido mínimo', description: 'Confira os produtos publicados e revise o pedido mínimo na aba Minha loja. Valor atual: R$ ' + Number(progress?.minimumOrder || 0).toFixed(2).replace('.', ',') + '.', completed: confirmed.includes('minimum_reviewed'), section: 'loja', confirmation: 'Conferi os dados' },
    { key: 'preview_opened', title: 'Prévia pública', description: 'Abra seu catálogo como o comprador o verá. Essa etapa registra apenas a abertura da prévia, não uma venda.', completed: confirmed.includes('preview_opened'), confirmation: 'Abrir minha loja' },
    { key: 'whatsapp_understood', title: 'Pedido pelo WhatsApp', description: 'O comprador monta o carrinho e toca em finalizar no WhatsApp da vendedora ativa. Esse clique não prova envio, pagamento ou venda concluída.', completed: confirmed.includes('whatsapp_understood'), confirmation: 'Entendi o fluxo' },
  ]
  const remaining = steps.filter(step => !step.completed)
  const next = steps.find(step => step.key === activeKey && !step.completed) ||
    remaining.find(step => !skipped.includes(step.key)) || remaining[0]
  const completedCount = steps.length - remaining.length

  const confirm = async (step: string) => {
    if (busy) return
    if (step === 'preview_opened') {
      const opened = window.open(storeUrl, '_blank', 'noopener,noreferrer')
      // Alguns navegadores retornam null com noopener mesmo quando abriram a aba;
      // o registro descreve a tentativa explícita, nunca garante carregamento da loja.
      if (!opened) setError('Se a prévia foi bloqueada, abra a loja pelo link do painel e retome esta etapa.')
    }
    setBusy(true); setError('')
    try {
      await apiRequest('/api/admin/growth/onboarding/confirm', { method: 'POST', body: JSON.stringify({ step }) })
      await reload()
      setActiveKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a etapa.')
    } finally { setBusy(false) }
  }

  if (completedCount === steps.length && progress) return <div className="svx-growth-complete"><Check size={16}/> Primeiros passos concluídos. Você pode alterar seus dados a qualquer momento.</div>
  return <section className="svx-growth-guide" aria-label="Primeiros passos da sua loja">
    <header className="svx-growth-guide__head">
      <div><span className="svx-kicker">PRIMEIROS PASSOS</span><h2>Prepare sua loja</h2><p>{progress ? completedCount + ' de 6 etapas verificadas' : 'Verificando a configuração…'}</p></div>
      <button type="button" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Retomar' : 'Recolher'} <RotateCcw size={15}/></button>
    </header>
    {!collapsed && <div className="svx-growth-guide__body">
      <div className="svx-growth-guide__track" aria-label={completedCount + ' de 6 etapas concluídas'}><span style={{ width: completedCount / 6 * 100 + '%' }}/></div>
      <ol className="svx-growth-guide__steps">{steps.map((step, i) => <li key={step.key} className={step.completed ? 'is-done' : step.key === next?.key ? 'is-current' : ''}><span>{step.completed ? <Check size={14}/> : i + 1}</span><span>{step.title}</span></li>)}</ol>
      {next && progress && <div className="svx-growth-guide__current">
        <span className="svx-kicker">PRÓXIMA ETAPA</span><h3>{next.title}</h3><p>{next.description}</p>
        <div className="svx-growth-guide__actions">
          {next.section && <button type="button" className="svx-growth-primary" onClick={() => onSection(next.section!)}>Ir para {next.section === 'temas' ? 'Temas e paletas' : next.section === 'loja' ? 'Minha loja' : next.section} <ArrowRight size={16}/></button>}
          {next.key === 'preview_opened' && <button type="button" className="svx-growth-primary" disabled={busy} onClick={() => void confirm(next.key)}>Abrir loja <ExternalLink size={15}/></button>}
          {next.confirmation && next.key !== 'preview_opened' && <button type="button" className="svx-growth-primary" disabled={busy} onClick={() => void confirm(next.key)}>{busy ? 'Registrando…' : next.confirmation} <Check size={15}/></button>}
          <button type="button" onClick={() => { setSkipped([...skipped, next.key]); setActiveKey('') }}>Pular por agora</button>
          <button type="button" onClick={() => { setSkipped([]); setActiveKey(''); void reload() }}>Retomar pendentes</button>
        </div>
      </div>}
      {error && <p className="svx-growth-error" role="alert"><HelpCircle size={15}/> {error}</p>}
      <small>Etapas automáticas dependem dos dados cadastrados; as confirmações manuais ficam registradas por loja. Pular não conclui nenhuma etapa.</small>
    </div>}
  </section>
}
