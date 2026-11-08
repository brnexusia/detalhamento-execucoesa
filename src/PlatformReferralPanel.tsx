import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import { CheckCircle2, ChevronDown, ChevronUp, RefreshCcw, Search, ShieldAlert } from 'lucide-react'
import './partner-portal.css'

type Partner={
 id:string;code:string;status:string;commission_cents:number;pix_key:string;created_at:string;name:string;email:string;
 referrals:number;registered_only:number;checkout_started:number;paid_referrals:number;reversed_referrals:number;
 pending_commission_cents:number;paid_commission_cents:number
}
type Claim={
 referred_store_id:string;referral_code:string;status:string;created_at:string;qualified_at:string|null;first_invoice_id:string|null;
 credit_months:number;credit_status:string;credit_amount_cents:number;commission_cents:number;commission_status:string;
 payout_reference:string|null;paid_at:string|null;referred_store:string;referring_store:string|null;partner_code:string|null;
 checkout_started_at:string|null;subscription_status:string|null
}
type DetailRow={
 referred_store_id:string;store_name:string;store_slug:string;store_email:string;registered_at:string;referral_code:string;
 status:string;created_at:string;qualified_at:string|null;reversed_at:string|null;first_invoice_id:string|null;
 checkout_started_at:string|null;subscription_status:string|null;paid_until:string|null;
 commission_cents:number;commission_status:string;paid_at:string|null;payout_reference:string|null
}
type PartnerDetail={partnerId:string;code:string;page:number;limit:number;total:number;items:DetailRow[]}
type ReferralReport={partners:Partner[];claims:Claim[];metrics:{
 pending:number;qualified:number;reversed:number;commissionPendingCents:number;commissionPaidCents:number;creditedMonths:number
}}
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'})
const stage=(row:{status:string;checkout_started_at?:string|null})=>
 row.status==='qualified'?'Pagamento confirmado':row.status==='reversed'?'Pagamento estornado':row.checkout_started_at?'Checkout iniciado · aguardando pagamento':'Cadastrado · ainda não iniciou Checkout'
const commissionStage=(row:{commission_status:string})=>({
 paid:'Repasse registrado',pending_approval:'Comissão aguardando aprovação/repasse',
 awaiting_rule:'Aguardando definição da comissão',reversal_due:'Estorno após repasse · conferir',
 reversed:'Comissão revertida',none:'Ainda não elegível'
} as Record<string,string>)[row.commission_status]||'Em análise'

export default function PlatformReferralPanel(){
 const [report,setReport]=useState<ReferralReport|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState('')
 const [cents,setCents]=useState<Record<string,string>>({})
 const [references,setReferences]=useState<Record<string,string>>({})
 const [search,setSearch]=useState('')
 const [expanded,setExpanded]=useState<string|null>(null)
 const [detail,setDetail]=useState<PartnerDetail|null>(null)
 const [detailLoading,setDetailLoading]=useState(false)
 const [detailError,setDetailError]=useState('')

 const fetchDetail=async(partnerId:string,page=1)=>{
  setDetailLoading(true);setDetailError('')
  try{
   const data=await apiRequest<PartnerDetail>('/api/platform/referrals/partners/'+encodeURIComponent(partnerId)+'/referrals?page='+page+'&limit=30')
   if(data?.partnerId!==partnerId||!Array.isArray(data.items))throw new Error('Resposta do detalhamento inválida.')
   setDetail(data)
  }catch(e){setDetail(null);setDetailError(e instanceof Error?e.message:'Falha ao carregar as lojas.')}
  finally{setDetailLoading(false)}
 }
 const load=async()=>{
  setLoading(true)
  try{
   const result=await apiRequest<ReferralReport>('/api/platform/referrals')
   setReport(result)
   setCents(Object.fromEntries(result.partners.map(p=>[p.id,(Number(p.commission_cents)/100).toFixed(2)])))
   setError('')
   if(expanded)await fetchDetail(expanded,detail?.page||1)
  }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar parceiros e indicações.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[])
 const toggle=async(partnerId:string)=>{
  if(expanded===partnerId){setExpanded(null);setDetail(null);setDetailError('');return}
  setExpanded(partnerId);setDetail(null)
  await fetchDetail(partnerId)
 }
 const edit=async(partner:Partner,body:Record<string,unknown>)=>{
  setBusy(partner.id);setError('')
  try{
   await apiRequest('/api/platform/referrals/partners/'+encodeURIComponent(partner.id),{method:'PATCH',body:JSON.stringify(body)})
   setNotice('Alteração registrada com auditoria.')
   await load()
  }catch(e){setError(e instanceof Error?e.message:'Falha ao atualizar o parceiro.')}
  finally{setBusy('')}
 }
 const payout=async(row:{referred_store_id:string;store_name?:string;referred_store?:string;commission_cents:number})=>{
  const reference=(references[row.referred_store_id]||'').trim()
  if(reference.length<6){setError('Informe um identificador comprovável do pagamento externo.');return}
  setBusy(row.referred_store_id);setError('')
  try{
   await apiRequest('/api/platform/referrals/claims/'+encodeURIComponent(row.referred_store_id)+'/payout',{method:'POST',body:JSON.stringify({reference})})
   setNotice('Repasse externo registrado com comprovante. Nenhum Pix foi enviado automaticamente.')
   await load()
  }catch(e){setError(e instanceof Error?e.message:'Falha ao registrar repasse.')}
  finally{setBusy('')}
 }
 const matching=report?.partners.filter(p=>[p.name,p.email,p.code].some(value=>value.toLowerCase().includes(search.trim().toLowerCase())))||[]
 return <div className="svx-referral-admin">
  <div className="platform-title"><span>STRIPE · REFERRAL</span><h1>Parceiros e indicações</h1>
   <p>Funil completo por parceiro: cadastro da loja, Checkout, primeiro pagamento confirmado, comissão e repasse.</p></div>
  <button className="platform-secondary" onClick={()=>void load()} disabled={loading}><RefreshCcw size={16}/> Atualizar</button>
  {error&&<p role="alert" className="svx-partner__error">{error}</p>}
  {notice&&<p role="status" className="svx-partner__notice"><CheckCircle2 size={16}/>{notice}</p>}
  {loading&&!report?<p>Carregando parceiros…</p>:report&&<>
   <div className="svx-partner__grid">
    {[
      ['Cadastros vinculados',report.partners.reduce((sum,p)=>sum+Number(p.referrals),0)],
      ['Sem Checkout',report.partners.reduce((sum,p)=>sum+Number(p.registered_only),0)],
      ['Checkout iniciado',report.partners.reduce((sum,p)=>sum+Number(p.checkout_started),0)],
      ['Pagamentos confirmados',report.partners.reduce((sum,p)=>sum+Number(p.paid_referrals),0)],
      ['Estornos',report.partners.reduce((sum,p)=>sum+Number(p.reversed_referrals),0)],
      ['Comissões a aprovar',money.format(report.partners.reduce((sum,p)=>sum+Number(p.pending_commission_cents),0)/100)],
    ].map(([name,value])=><article key={name}><small>{name}</small><strong>{value}</strong></article>)}
   </div>
   <section className="svx-partner__card">
    <div className="svx-referral-admin__section-head"><div><h2>Parceiros independentes</h2>
     <p>Selecione um parceiro para consultar cada loja cadastrada, mesmo sem Checkout. A comissão só nasce após a primeira fatura Stripe confirmada.</p></div>
     <label className="svx-referral-admin__search"><Search size={16}/><input aria-label="Buscar parceiro por nome, e-mail ou código" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar parceiro"/></label>
    </div>
    <div className="svx-referral-admin__partners">
     {matching.map(p=><article className="svx-referral-admin__partner" key={p.id}>
      <div className="svx-referral-admin__partner-head"><div><strong>{p.name}</strong><small>{p.email} · {p.code}</small><small>Conta: {p.status==='active'?'Ativa':p.status==='pending'?'Aguardando ativação':'Suspensa'} · Pix {p.pix_key?'cadastrada':'pendente'}</small></div>
       <button type="button" aria-expanded={expanded===p.id} onClick={()=>void toggle(p.id)}>
        {expanded===p.id?<ChevronUp size={15}/>:<ChevronDown size={15}/>} {expanded===p.id?'Fechar lojas':'Ver lojas'}
       </button>
      </div>
      <div className="svx-referral-admin__funnel">
       {[
        ['Cadastros',p.referrals],['Sem Checkout',p.registered_only],['Checkout pendente',p.checkout_started],
        ['Pagamentos',p.paid_referrals],['Estornos',p.reversed_referrals],
        ['Comissão pendente',money.format(Number(p.pending_commission_cents)/100)],
        ['Repasse registrado',money.format(Number(p.paid_commission_cents)/100)]
       ].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}
      </div>
      <div className="svx-referral-admin__partner-controls">
       <label>Comissão por primeira conversão (R$)
        <input aria-label={'Comissão para '+p.name} type="number" min="0" max="100000" step=".01"
         value={cents[p.id]||'0'} onChange={e=>setCents(x=>({...x,[p.id]:e.target.value}))}/></label>
       <button disabled={busy===p.id} onClick={()=>void edit(p,{commissionCents:Math.round(Number(cents[p.id]||0)*100),applyToPending:true})}>Salvar comissão</button>
       <button disabled={busy===p.id} onClick={()=>void edit(p,{status:p.status==='active'?'suspended':'active'})}>{p.status==='active'?'Suspender':'Aprovar/ativar'}</button>
      </div>
      {expanded===p.id&&<div className="svx-referral-admin__detail">
       <h3>Lojas indicadas por {p.name}</h3>
       {detailLoading&&<p role="status">Carregando histórico da indicação…</p>}
       {detailError&&<p role="alert" className="svx-partner__error">{detailError}</p>}
       {detail?.partnerId===p.id&&<>
        <p>{detail.total} {detail.total===1?'loja vinculada':'lojas vinculadas'} · página {detail.page} de {Math.max(1,Math.ceil(detail.total/detail.limit))}. Histórico paginado, sem limitar a 500 registros.</p>
        <div className="svx-referral-admin__scroll"><table><thead><tr>
         <th>Loja e cadastro</th><th>Etapa</th><th>Assinatura</th><th>Comissão</th><th>Repasse</th>
        </tr></thead><tbody>{detail.items.map(row=><tr key={row.referred_store_id}>
         <td><strong>{row.store_name}</strong><small>{row.store_email}</small><small>Cadastro: {date.format(new Date(row.registered_at))}</small></td>
         <td><strong>{stage(row)}</strong><small>{row.checkout_started_at?'Checkout: '+date.format(new Date(row.checkout_started_at)):'Nenhum Checkout iniciado'}</small></td>
         <td>{row.status==='qualified'?'Primeira fatura confirmada':row.status==='reversed'?'Pagamento estornado':'Primeira fatura não confirmada'}<small>{row.first_invoice_id||'Sem fatura paga'}</small></td>
         <td>{money.format(Number(row.commission_cents)/100)}<small>{commissionStage(row)}</small></td>
         <td>{row.commission_status==='pending_approval'&&Number(row.commission_cents)>0?
           <div className="svx-referral-admin__actions"><input aria-label={'Comprovante '+row.store_name} value={references[row.referred_store_id]||''} onChange={e=>setReferences(x=>({...x,[row.referred_store_id]:e.target.value}))} placeholder="ID comprovante Pix"/><button disabled={busy===row.referred_store_id} onClick={()=>void payout(row)}>Registrar pago</button></div>
           :row.commission_status==='paid'?<span>Registrado: {row.payout_reference}</span>:'—'}</td>
        </tr>)}</tbody></table></div>
        {!detail.items.length&&<p>Nenhuma loja vinculada.</p>}
        <div className="svx-referral-admin__pagination"><button disabled={detailLoading||detail.page<=1} onClick={()=>void fetchDetail(p.id,detail.page-1)}>Anterior</button>
         <span>Página {detail.page}</span>
         <button disabled={detailLoading||detail.page*detail.limit>=detail.total} onClick={()=>void fetchDetail(p.id,detail.page+1)}>Próxima</button></div>
       </>}
      </div>}
     </article>)}
    </div>
    {!matching.length&&<p>Nenhum parceiro encontrado.</p>}
   </section>
   <section className="svx-partner__card"><h2>Conciliação geral de indicações</h2>
    <p>Últimas 500 indicações de parceiros e lojas indicadoras. Para o histórico completo de um parceiro, use “Ver lojas” acima.</p>
    <div className="svx-referral-admin__scroll"><table><thead><tr><th>Loja</th><th>Indicador</th><th>Etapa</th><th>Benefício / comissão</th><th>Repasse</th></tr></thead><tbody>{report.claims.map(row=><tr key={row.referred_store_id}>
     <td><strong>{row.referred_store}</strong><small>{date.format(new Date(row.created_at))}</small></td>
     <td>{row.referring_store||row.partner_code||'—'}<small>{row.referral_code}</small></td>
     <td>{stage(row)}<small>{row.first_invoice_id||'Sem fatura paga'}</small></td>
     <td>{row.partner_code?money.format(Number(row.commission_cents)/100):row.credit_status==='applied'?'Crédito lançado na Stripe':row.credit_status==='pending'?'Crédito aguardando aplicação':'Sem crédito'}<small>{row.partner_code?commissionStage(row):''}</small></td>
     <td>{row.commission_status==='pending_approval'&&Number(row.commission_cents)>0?
      <div className="svx-referral-admin__actions"><input aria-label={'Comprovante '+row.referred_store} value={references[row.referred_store_id]||''} onChange={e=>setReferences(x=>({...x,[row.referred_store_id]:e.target.value}))} placeholder="ID do Pix"/><button disabled={busy===row.referred_store_id} onClick={()=>void payout(row)}>Registrar pago</button></div>
      :row.commission_status==='paid'?<span>Registrado: {row.payout_reference}</span>:'—'}</td>
    </tr>)}</tbody></table></div>{!report.claims.length&&<p>Nenhuma indicação atribuída.</p>}
   </section>
   <p className="svx-partner__warning"><ShieldAlert size={17}/> Um cadastro não é uma venda. Apenas o webhook Stripe de primeira fatura paga qualifica a indicação; o registro de repasse exige comprovante de pagamento externo e nunca envia Pix.</p>
  </>}
 </div>
}
