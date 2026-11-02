import { useEffect,useState } from 'react'
import { apiRequest } from './api'
import { CheckCircle2,RefreshCcw,ShieldAlert } from 'lucide-react'
import './partner-portal.css'
type Partner={id:string;code:string;status:string;commission_cents:number;pix_key:string;created_at:string;name:string;email:string;referrals:number}
type Claim={referred_store_id:string;referral_code:string;status:string;created_at:string;qualified_at:string|null;first_invoice_id:string|null;credit_months:number;credit_status:string;credit_amount_cents:number;commission_cents:number;commission_status:string;payout_reference:string|null;paid_at:string|null;referred_store:string;referring_store:string|null;partner_code:string|null}
type ReferralReport={partners:Partner[];claims:Claim[];metrics:{pending:number;qualified:number;reversed:number;commissionPendingCents:number;commissionPaidCents:number;creditedMonths:number}}
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const dt=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'})
export default function PlatformReferralPanel(){
 const [report,setReport]=useState<ReferralReport|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState('')
 const [cents,setCents]=useState<Record<string,string>>({})
 const [references,setReferences]=useState<Record<string,string>>({})
 const load=async()=>{
   setLoading(true)
   try{const result=await apiRequest<ReferralReport>('/api/platform/referrals');setReport(result);setCents(Object.fromEntries(result.partners.map(p=>[p.id,(Number(p.commission_cents)/100).toFixed(2)])));setError('')}
   catch(err){setError(err instanceof Error?err.message:'Falha ao carregar parceiros e indicações.')}
   finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[])
 const edit=async(partner:Partner,body:Record<string,unknown>)=>{
  setBusy(partner.id);setError('')
  try{
    await apiRequest('/api/platform/referrals/partners/'+encodeURIComponent(partner.id),{method:'PATCH',body:JSON.stringify(body)})
    setNotice('Alteração registrada com auditoria.')
    await load()
  }catch(e){setError(e instanceof Error?e.message:'Falha ao atualizar o parceiro.')}
  finally{setBusy('')}
 }
 const payout=async(row:Claim)=>{
  const reference=(references[row.referred_store_id]||'').trim()
  if(reference.length<6){setError('Informe um identificador comprovável do pagamento externo.');return}
  setBusy(row.referred_store_id);setError('')
  try {
    await apiRequest('/api/platform/referrals/claims/'+encodeURIComponent(row.referred_store_id)+'/payout',{method:'POST',body:JSON.stringify({reference})})
    setNotice('Pagamento externo registrado. Nenhum Pix foi transferido pela plataforma.')
    await load()
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar o repasse.')}
  finally{setBusy('')}
 }
 return <div className="svx-referral-admin">
  <div className="platform-title"><span>STRIPE · REFERRAL</span><h1>Parceiros e indicações</h1><p>Atribuição por código, conversão somente por pagamento confirmado, créditos de lojistas e comissões de parceiros.</p></div>
  <button className="platform-secondary" onClick={()=>void load()} disabled={loading}><RefreshCcw size={16}/> Atualizar</button>
  {error&&<p role="alert" className="svx-partner__error">{error}</p>}
  {notice&&<p role="status" className="svx-partner__notice"><CheckCircle2 size={16}/>{notice}</p>}
  {loading&&!report?<p>Carregando métricas de indicações…</p>:report&&<>
   <div className="svx-partner__grid">
    {[['Indicações pendentes',report.metrics.pending],['Pagamentos confirmados',report.metrics.qualified],['Estornos',report.metrics.reversed],['Créditos Stripe aplicados',report.metrics.creditedMonths],['Comissões aguardando',money.format(report.metrics.commissionPendingCents/100)],['Pagamentos registrados',money.format(report.metrics.commissionPaidCents/100)]].map(([k,val])=><article key={k}><small>{k}</small><strong>{val}</strong></article>)}
   </div>
   <section className="svx-partner__card"><h2>Parceiros independentes</h2><p>Aprovação e comissão fixa por conversão são decisões administrativas. O valor padrão é zero; nenhuma comissão é presumida.</p>
    <div className="svx-referral-admin__scroll"><table><thead><tr><th>Parceiro</th><th>Status</th><th>Indicações</th><th>Regra por pagamento</th><th>Ações</th></tr></thead><tbody>{report.partners.map(p=><tr key={p.id}>
     <td><strong>{p.name}</strong><small>{p.email}</small><small>{p.code}</small><small>Pix: {p.pix_key?'cadastrada':'pendente'}</small></td>
     <td>{p.status==='active'?'Ativo':p.status==='pending'?'Aguardando aprovação':'Suspenso'}</td>
     <td>{p.referrals}</td>
     <td><label>R$ <input aria-label={'Comissão para '+p.name} type="number" min="0" max="100000" step=".01" value={cents[p.id]||'0'} onChange={e=>setCents(x=>({...x,[p.id]:e.target.value}))}/></label></td>
     <td><div className="svx-referral-admin__actions"><button disabled={busy===p.id} onClick={()=>void edit(p,{status:p.status==='active'?'suspended':'active'})}>{p.status==='active'?'Suspender':'Aprovar/ativar'}</button><button disabled={busy===p.id} onClick={()=>void edit(p,{commissionCents:Math.round(Number(cents[p.id]||0)*100),applyToPending:true})}>Salvar comissão</button></div></td>
    </tr>)}</tbody></table></div>{!report.partners.length&&<p>Não há parceiros cadastrados.</p>}</section>
   <section className="svx-partner__card"><h2>Indicações e conciliação Stripe</h2><p>O histórico é baseado em pagamentos confirmados por webhook autenticado. Registrar um repasse aqui não envia dinheiro: exige comprovante externo e fica auditado.</p>
    <div className="svx-referral-admin__scroll"><table><thead><tr><th>Loja indicada</th><th>Indicador</th><th>Pagamento Stripe</th><th>Benefício / comissão</th><th>Repasse externo</th></tr></thead><tbody>{report.claims.map(row=><tr key={row.referred_store_id}>
     <td><strong>{row.referred_store}</strong><small>{dt.format(new Date(row.created_at))}</small></td>
     <td>{row.referring_store||row.partner_code||'—'}<small>{row.referral_code}</small></td>
     <td>{row.status==='pending'?'Aguardando primeiro pagamento':row.status==='reversed'?'Estornado':'Pago'}<small>{row.first_invoice_id||'Sem fatura confirmada'}</small></td>
     <td>{row.partner_code?money.format(row.commission_cents/100):row.credit_status==='applied'?'Crédito lançado na Stripe':row.credit_status==='pending'?'Crédito aguardando aplicação':'Sem crédito'}<small>{row.partner_code?row.commission_status:''}</small></td>
     <td>{row.commission_status==='pending_approval'&&row.commission_cents>0?
       <div className="svx-referral-admin__actions"><input aria-label={'Comprovante '+row.referred_store} value={references[row.referred_store_id]||''} onChange={e=>setReferences(x=>({...x,[row.referred_store_id]:e.target.value}))} placeholder="ID do Pix realizado"/><button disabled={busy===row.referred_store_id} onClick={()=>void payout(row)}>Registrar pago</button></div>
       :row.commission_status==='paid'?<span>Registrado: {row.payout_reference}</span>:'—'}</td>
    </tr>)}</tbody></table></div>{!report.claims.length&&<p>Nenhuma indicação atribuída.</p>}</section>
   <p className="svx-partner__warning"><ShieldAlert size={17}/> Pagamentos reais, reembolsos e repasses dependem de credenciais Stripe e operação externa devidamente configuradas. Não são simulados nesta tela.</p>
  </>}
 </div>
}
