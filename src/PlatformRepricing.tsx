import { useEffect, useState } from 'react'
import { apiRequest } from './api'

type Code = 'bronze' | 'prata' | 'ouro'
type Scope = 'selected' | 'all'
type Target = { storeId: string; name: string; email: string; cycle: string; paidUntil: string; targetAmountCents: number | null }
type Preview = { planCode: Code; targets: Target[]; previewHash: string }
type Listing = Preview & { count: number; truncated: boolean; maxBatch: number }
type Result = { planCode: Code; updated: number; unchanged: number; failed: number; results: Array<{ storeId:string; status:string; reason?:string }> }

const labels: Record<Code,string> = { bronze:'Bronze',prata:'Prata',ouro:'Ouro' }
const cycles:Record<string,string> = {monthly:'Mensal',semiannual:'Semestral',annual:'Anual'}
const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})

export default function PlatformRepricing() {
  const [planCode,setPlanCode] = useState<Code>('bronze')
  const [listing,setListing] = useState<Listing|null>(null)
  const [selected,setSelected] = useState<string[]>([])
  const [scope,setScope] = useState<Scope>('selected')
  const [preview,setPreview] = useState<Preview|null>(null)
  const [confirmation,setConfirmation] = useState('')
  const [noticeConfirmed,setNoticeConfirmed] = useState(false)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [result,setResult] = useState<Result|null>(null)

  const clearDecision = () => {
    setPreview(null);setConfirmation('');setNoticeConfirmed(false);setError('');setResult(null)
  }

  const load = async (code:Code) => {
    setLoading(true);setError('');setPreview(null);setSelected([]);setResult(null)
    try {
      setListing(await apiRequest<Listing>('/api/platform/billing/repricing?planCode='+encodeURIComponent(code),{cache:'no-store'}))
    } catch (e) {
      setListing(null)
      setError(e instanceof Error?e.message:'Não foi possível consultar as assinaturas.')
    } finally {setLoading(false)}
  }

  useEffect(()=>{void load(planCode)},[planCode])

  const select = (id:string,checked:boolean) => {
    setSelected(current=>checked?[...current,id]:current.filter(x=>x!==id))
    clearDecision()
  }

  const previewChange = async () => {
    if (!listing || (scope==='selected' && !selected.length)) return
    setBusy(true);setError('');setPreview(null);setResult(null)
    try {
      const payload = await apiRequest<Preview>('/api/platform/billing/repricing/preview',{
        method:'POST',
        body:JSON.stringify({planCode,scope,storeIds:scope==='selected'?selected:undefined}),
      })
      setPreview(payload);setConfirmation('');setNoticeConfirmed(false)
    } catch (e) {setError(e instanceof Error?e.message:'Não foi possível preparar a prévia.')}
    finally {setBusy(false)}
  }

  const apply = async () => {
    if (!preview || confirmation!=='REAJUSTAR' || !noticeConfirmed) return
    setBusy(true);setError('');setResult(null)
    try {
      const done = await apiRequest<Result>('/api/platform/billing/repricing/apply',{
        method:'POST',
        body:JSON.stringify({
          planCode,scope,storeIds:scope==='selected'?selected:undefined,
          previewHash:preview.previewHash,confirmation,noticeAcknowledged:noticeConfirmed,
          requestId:crypto.randomUUID(),
        }),
      })
      setResult(done);setPreview(null);setConfirmation('');setNoticeConfirmed(false)
      // Keep the action summary visible even when the selection is refreshed.
    } catch (e) {setError(e instanceof Error?e.message:'Não foi possível aplicar o reajuste.')}
    finally {setBusy(false)}
  }

  return <section className="platform-reprice">
    <header>
      <span>GESTÃO DE COBRANÇAS · STRIPE</span>
      <h2>Reajustar assinaturas existentes</h2>
      <p>Editar o preço de um plano acima afeta somente novas contratações. Use esta ferramenta apenas para migrar assinantes existentes, quando a mudança for permitida e tiver sido comunicada aos clientes.</p>
    </header>
    <div className="platform-reprice__safety">
      <strong>Sem cobrança imediata</strong>
      <p>A troca do preço mantém o ciclo atual e solicita à Stripe que não faça cobrança proporcional. O novo preço será usado na próxima fatura de renovação. Assinaturas antigas não são alteradas sem confirmação aqui.</p>
    </div>
    <div className="platform-reprice__controls">
      <label>Plano
        <select value={planCode} onChange={e=>{setPlanCode(e.target.value as Code);clearDecision()}}>
          {(['bronze','prata','ouro'] as const).map(code=><option value={code} key={code}>{labels[code]}</option>)}
        </select>
      </label>
      <button type="button" className="platform-secondary" disabled={busy || loading} onClick={()=>void load(planCode)}>Atualizar lista</button>
    </div>
    {loading && <p role="status">Consultando assinaturas ativas…</p>}
    {error && <p className="platform-reprice__error" role="alert">{error}</p>}
    {listing && !loading && <>
      <p><strong>{listing.truncated?'Mais de 50':listing.count}</strong> assinaturas ativas elegíveis para {labels[planCode]}. {listing.truncated?'Por segurança, selecione um lote de até 50 clientes por vez.':''}</p>
      <fieldset className="platform-reprice__scope">
        <legend>Quem receberá o novo preço?</legend>
        <label><input type="radio" name="reprice-scope" checked={scope==='selected'} onChange={()=>{setScope('selected');clearDecision()}}/> Apenas as contas que eu selecionar</label>
        <label><input type="radio" name="reprice-scope" checked={scope==='all'} disabled={listing.truncated} onChange={()=>{setScope('all');clearDecision()}}/> Todas as contas elegíveis deste plano (máximo 50)</label>
      </fieldset>
      <div className="platform-reprice__list" role="group" aria-label="Assinaturas elegíveis">
        {listing.targets.length===0 && <p>Nenhuma assinatura paga elegível neste plano.</p>}
        {listing.targets.map(target=><label key={target.storeId} className="platform-reprice__row">
          <input type="checkbox" disabled={scope==='all'||busy} checked={scope==='all'||selected.includes(target.storeId)} onChange={e=>select(target.storeId,e.target.checked)}/>
          <span><strong>{target.name}</strong><small>{target.email}</small></span>
          <span><small>{cycles[target.cycle]||target.cycle}</small><b>{target.targetAmountCents!=null?money.format(target.targetAmountCents/100):'Indisponível'}</b></span>
        </label>)}
      </div>
      <button type="button" className="platform-secondary" disabled={busy||!listing.targets.length||(scope==='selected'&&!selected.length)} onClick={()=>void previewChange()}>{busy?'Consultando…':'Conferir prévia do reajuste'}</button>
    </>}
    {preview && <div className="platform-reprice__preview">
      <h3>Prévia — {preview.targets.length} assinatura(s)</h3>
      <p>Os valores abaixo são os totais do próximo ciclo de cobrança, não cobranças imediatas.</p>
      <ul>{preview.targets.map(row=><li key={row.storeId}>{row.name} · {cycles[row.cycle]||row.cycle} · <strong>{money.format((row.targetAmountCents||0)/100)}</strong></li>)}</ul>
      <label className="platform-reprice__ack"><input type="checkbox" checked={noticeConfirmed} onChange={e=>setNoticeConfirmed(e.target.checked)}/> Confirmo que os clientes afetados receberam o aviso prévio adequado e que estou autorizado a realizar este reajuste.</label>
      <label>Digite <strong>REAJUSTAR</strong> para autorizar a alteração das assinaturas selecionadas.
        <input type="text" value={confirmation} onChange={e=>setConfirmation(e.target.value.toUpperCase())} autoComplete="off" placeholder="REAJUSTAR"/>
      </label>
      <button type="button" className="platform-primary" onClick={()=>void apply()} disabled={busy||!noticeConfirmed||confirmation!=='REAJUSTAR'}>{busy?'Processando…':'Confirmar reajuste na próxima renovação'}</button>
    </div>}
    {result && <div className="platform-reprice__result" role="status">
      <strong>Resultado: {result.updated} atualizadas · {result.unchanged} sem mudança · {result.failed} com falha.</strong>
      <p>Nenhuma cobrança proporcional foi solicitada. Confira os registros na Stripe e a próxima fatura de cada cliente.</p>
      {result.results.filter(x=>x.status==='failed').map(x=><p key={x.storeId}>Falha na loja {x.storeId}: {x.reason}</p>)}
    </div>}
  </section>
}
