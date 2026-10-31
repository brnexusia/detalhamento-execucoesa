import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Camera, CircleHelp, X } from 'lucide-react'
import { apiRequest } from './api'
import './shopvax-growth.css'

type Topic = 'account' | 'catalog' | 'order' | 'billing' | 'privacy' | 'other'
const TOPICS: { value: Topic; label: string }[] = [
  { value:'account', label:'Conta e acesso' },{ value:'catalog', label:'Loja e produtos' },
  { value:'order', label:'Pedidos no WhatsApp' },{ value:'billing', label:'Planos e contratação' },
  { value:'privacy', label:'Privacidade e consentimento' },{ value:'other', label:'Outro assunto' },
]

export default function ShopvaxSupport() {
  const path = window.location.pathname
  const merchant = path.startsWith('/painel') || path === '/entrar' || path === '/criar-conta'
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [supportWhatsapp, setSupportWhatsapp] = useState<string | null>(null)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiConsent, setAiConsent] = useState(false)
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [topic, setTopic] = useState<Topic>('catalog')
  const [message, setMessage] = useState('')
  const [replyEmail, setReplyEmail] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    apiRequest<{ ticketsEnabled: boolean; aiEnabled: boolean; supportWhatsapp?: string | null }>('/api/public/support/config')
      .then(config => {
        setEnabled(config.ticketsEnabled === true)
        setAiEnabled(config.aiEnabled === true)
        setSupportWhatsapp(/^\d{11,15}$/.test(config.supportWhatsapp || '') ? config.supportWhatsapp! : null)
      })
      .catch(() => { setEnabled(false); setAiEnabled(false); setSupportWhatsapp(null) })
  }, [])
  const faq = merchant ? [
    ['Como publicar?', 'Cadastre sua primeira vendedora ativa, adicione produtos, configure o pedido mínimo e abra a prévia em Ver loja.'],
    ['Onde chegam os pedidos?', 'O comprador abre o WhatsApp da vendedora ativa. O número principal da loja não recebe pedidos. Abrir o WhatsApp não confirma uma venda.'],
    ['Onde encontro a assinatura?', 'Consulte a área de planos ou operação do painel do lojista. Não há contratação no carrinho do comprador.'],
  ] : [
    ['Como montar o pedido?', 'Escolha as peças e quantidades, confira o pedido mínimo e toque para conversar com a vendedora pelo WhatsApp.'],
    ['O pedido já foi pago?', 'Não. A plataforma prepara o pedido e registra a intenção. Pagamento e confirmação são combinados com a vendedora.'],
    ['Como deixar de receber ofertas?', 'Entre em sua conta de comprador e abra Preferências de ofertas. WhatsApp e e-mail podem ser cancelados separadamente.'],
  ]
  const shareFile = async (file?: File) => {
    if (!file) return
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Captura para solicitar ajuda' }) }
      catch { setFeedback('Compartilhamento não concluído. A imagem não foi enviada ao Shopvax.') }
    } else {
      setFeedback('O navegador não suporta compartilhar esta captura aqui. Você pode anexá-la manualmente no canal de atendimento que escolher. Nenhum arquivo foi enviado ao Shopvax.')
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setFeedback(''); setBusy(true)
    try {
      const result = await apiRequest<{ id: string }>('/api/public/support/tickets', {
        method: 'POST', body: JSON.stringify({ audience: merchant ? 'merchant' : 'buyer', topic, message, replyEmail, privacyAcknowledged: acknowledged }),
      })
      setFeedback('Solicitação registrada: ' + result.id + '. Pendente de análise humana; não foi enviada por WhatsApp ou e-mail.')
      setMessage('')
    } catch (err) { setFeedback(err instanceof Error ? err.message : 'Não foi possível registrar a solicitação.') }
    finally { setBusy(false) }
  }
  const assist = async (event: React.FormEvent) => {
    event.preventDefault()
    setAiAnswer(''); setFeedback(''); setAiBusy(true)
    try {
      const result = await apiRequest<{ answer: string; needsHuman: boolean }>('/api/public/support/assist', {
        method:'POST',body:JSON.stringify({
          audience: merchant ? 'merchant' : 'buyer',topic,
          question:aiQuestion,privacyAcknowledged:aiConsent,
        }),
      })
      setAiAnswer(result.answer + (result.needsHuman ? ' Para este assunto, confirme com o atendimento humano antes de tomar uma decisão.' : ''))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível consultar o assistente.')
    } finally { setAiBusy(false) }
  }
  return <div className={`svx-support ${!merchant && !path.startsWith('/cliente') ? 'svx-support--store' : ''}`}>
    <button type="button" className="svx-support__trigger" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="svx-support-panel"><CircleHelp size={19}/> Precisa de ajuda?</button>
    {open && <section id="svx-support-panel" className="svx-support__panel" aria-label="Ajuda contextual Shopvax">
      <header><div><span className="svx-kicker">AJUDA · SHOPVAX</span><h2>{merchant ? 'Ajuda para lojistas' : 'Ajuda para compradores'}</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Fechar ajuda"><X size={19}/></button></header>
      <p>Escolha uma dúvida abaixo. A página não detecta capturas de tela automaticamente.</p>
      <details className="svx-support__video">
        <summary>Ver vídeo explicativo do Shopvax (12 segundos) <ArrowRight size={14}/></summary>
        <video controls playsInline preload="none" width="640" height="360" aria-label="Tutorial Shopvax: catálogo, grade, talão e WhatsApp">
          <source src="/help/shopvax-guide.mp4" type="video/mp4" />
          Seu navegador não permite reproduzir este vídeo. Leia a transcrição abaixo.
        </video>
        <p><strong>Transcrição:</strong> 1. Explore o catálogo e confira os produtos, fotos e preços da loja. 2. Escolha variações e quantidades. 3. Revise o pedido mínimo e o total — talão preparado não é venda confirmada. 4. Abra o WhatsApp da vendedora; abrir a conversa não comprova envio nem pagamento.</p>
      </details>
      <div className="svx-support__faqs">{faq.map(([question, answer]) => <details key={question}><summary>{question} <ArrowRight size={14}/></summary><p>{answer}</p></details>)}</div>
      <div className="svx-support__screenshot">
        <p><Camera size={16}/> Quer mostrar a tela? Escolha uma captura no seu dispositivo para compartilhar usando os recursos do navegador, quando disponíveis.</p>
        <input ref={fileRef} id="svx-share-screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void shareFile(e.target.files?.[0])}/>
      </div>
      {aiEnabled && <form onSubmit={assist} className="svx-support__form svx-support__ai">
        <strong>Orientação automática da Shopvax</strong>
        <p>Respostas gerais, sem acesso aos seus pedidos, dados da conta ou mensagens. A IA não envia WhatsApp e pode errar.</p>
        <label>Assunto<select value={topic} onChange={e => setTopic(e.target.value as Topic)}>{TOPICS.filter(t => merchant || t.value !== 'billing').map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <label>Sua dúvida (sem dados pessoais)<textarea value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} minLength={8} maxLength={600} required/></label>
        <label className="svx-support__check"><input type="checkbox" checked={aiConsent} onChange={e => setAiConsent(e.target.checked)} required/> Concordo em enviar somente esta pergunta, sem informações pessoais, ao fornecedor de IA.</label>
        <button type="submit" disabled={aiBusy}>{aiBusy ? 'Consultando…' : 'Pedir orientação à IA'}</button>
        {aiAnswer && <p className="svx-support__ai-answer" role="status">{aiAnswer}</p>}
      </form>}
      {supportWhatsapp && <a className="svx-support__whatsapp" href={`https://wa.me/${supportWhatsapp}?text=${encodeURIComponent('Olá! Preciso de ajuda com a plataforma Shopvax.')}`} target="_blank" rel="noopener noreferrer">Conversar com a central Shopvax pelo WhatsApp <ArrowRight size={16}/></a>}
      {enabled ? <form onSubmit={submit} className="svx-support__form">
        <strong>Abrir solicitação de suporte</strong>
        <label>Assunto<select value={topic} onChange={e => setTopic(e.target.value as Topic)}>{TOPICS.filter(t => merchant || t.value !== 'billing').map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <label>Descreva o que aconteceu<textarea value={message} onChange={e => setMessage(e.target.value)} minLength={15} maxLength={2000} required/></label>
        <label>E-mail de retorno {merchant ? '(opcional)' : '(obrigatório para resposta)'}<input type="email" value={replyEmail} onChange={e => setReplyEmail(e.target.value)} maxLength={200} required={!merchant}/></label>
        <label className="svx-support__check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} required/> Autorizo o registro mínimo desta solicitação para análise humana. Não vou enviar senhas ou dados de pagamento.</label>
        <button type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar solicitação'}</button>
      </form> : !aiEnabled && !supportWhatsapp && <p className="svx-support__disabled">O canal central de solicitações ainda não foi ativado. As orientações acima estão disponíveis; não há telefone ou IA de suporte ativos nesta tela.</p>}
      {feedback && <p className="svx-growth-status" role="status">{feedback}</p>}
    </section>}
  </div>
}
