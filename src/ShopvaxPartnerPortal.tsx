import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, Handshake, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
import './partner-portal.css'

type Partner = {name:string;email:string;code:string|null;status:string;commissionCents:number;pixKey:string;createdAt:string}
type Referral = {storeName:string;status:string;createdAt:string;qualifiedAt:string|null;commissionCents:number;commissionStatus:string;paidAt:string|null;checkoutStartedAt:string|null}
type Dashboard = {partner:Partner;metrics:{visits:number;registered:number;qualified:number;pending:number;registeredOnly:number;checkoutStarted:number;earnedCents:number;paidCents:number};referrals:Referral[]}
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'})
function go(path:string){window.history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'))}
export default function ShopvaxPartnerPortal(){
 const [mode,setMode]=useState<'login'|'register'>(window.location.pathname.endsWith('/cadastro')?'register':'login')
 const [form,setForm]=useState({name:'',email:'',password:'',pixKey:''})
 const [dashboard,setDashboard]=useState<Dashboard|null>(null)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const load=async():Promise<boolean>=>{
   try{
     const result=await apiRequest<Dashboard>('/api/partners/dashboard')
     if(!result?.partner)throw new Error('Resposta de sessão de parceiro inválida.')
     setDashboard(result);setError('');return true
   }catch{setDashboard(null);return false}
   finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[])
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('')
  try{
   const result=await apiRequest<{ok:boolean;code?:string}>('/api/partners/'+(mode==='register'?'register':'login'),{method:'POST',body:JSON.stringify({name:form.name,email:form.email,password:form.password})})
   if(result?.ok!==true)throw new Error('O servidor não confirmou a operação. Verifique se o backend do ShopVax está publicado e acessível.')
   const signedIn=await load()
   if(!signedIn){
     if(mode==='register'){setMode('login');go('/parceiros/entrar')}
     throw new Error(mode==='register'?'Conta cadastrada, mas a sessão não abriu. Entre com o e-mail e a senha que acabou de cadastrar.':'Não foi possível abrir seu painel. Tente entrar novamente.')
   }
   setForm(x=>({...x,password:''}))
   if(mode==='register')setNotice('Conta criada! Seu código e link já estão vinculados à sua conta.')
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível acessar o programa.')}
  finally{setBusy(false)}
 }
 const logout=async()=>{
  await apiRequest('/api/auth/logout',{method:'POST'}).catch(()=>undefined)
  setDashboard(null);setMode('login');go('/parceiros/entrar')
 }
 const updatePix=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('')
  try{
   await apiRequest('/api/partners/pix',{method:'PUT',body:JSON.stringify({pixKey:form.pixKey})})
   setNotice('Chave Pix registrada para conferência administrativa.')
   await load()
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível salvar a chave Pix.')}
  finally{setBusy(false)}
 }
 const code=dashboard?.partner.code || ''
 const canShare=dashboard?.partner.status==='active'
 const link=code&&canShare?window.location.origin+'/criar-conta?ref='+encodeURIComponent(code):''
 const copy=async(value:string,kind:'código'|'link')=>{
   setError('')
   try{
     if(!navigator.clipboard?.writeText)throw new Error('Área de transferência indisponível.')
     await navigator.clipboard.writeText(value)
     setNotice((kind==='link'?'Link':'Código')+' copiado!')
   }catch{setError('Não foi possível copiar automaticamente. Selecione o '+kind+' exibido e copie manualmente.')}
 }
 return <main className="svx-partner">
  <header className="svx-partner__top"><a href="/"><span>SHOPVAX</span> · PARCEIROS</a><span><Handshake size={18}/> Programa de indicações</span></header>
  {loading?<p>Carregando área de parceiros…</p>:!dashboard?
   <section className="svx-partner__auth">
    <span className="svx-partner__eyebrow">PORTAL INDEPENDENTE</span>
    <h1>{mode==='register'?'Seja parceiro ShopVax.':'Acesse seu painel de indicações.'}</h1>
    <p>Indique lojistas. A conversão somente é reconhecida após o primeiro pagamento confirmado pela Stripe. Os valores das comissões são definidos e aprovados pela administração.</p>
    <form onSubmit={submit}>
     {mode==='register'&&<label>Nome completo<input required maxLength={120} autoComplete="name" value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))}/></label>}
     <label>E-mail<input required type="email" autoComplete="email" value={form.email} onChange={e=>setForm(x=>({...x,email:e.target.value}))}/></label>
     <label>Senha<input required type="password" minLength={mode==='register'?12:1} maxLength={200} autoComplete={mode==='register'?'new-password':'current-password'} value={form.password} onChange={e=>setForm(x=>({...x,password:e.target.value}))}/></label>
     {error&&<p role="alert" className="svx-partner__error">{error}</p>}
     <button disabled={busy}>{busy?'Processando…':mode==='register'?'Criar conta de parceiro':'Entrar como parceiro'} <ArrowRight size={17}/></button>
    </form>
    <button className="svx-partner__link" type="button" onClick={()=>{const next=mode==='login'?'register':'login';setMode(next);go('/parceiros/'+(next==='login'?'entrar':'cadastro'))}}>{mode==='login'?'Ainda não é parceiro? Cadastre-se':'Já tem cadastro? Entre'}</button>
   </section>:
   <div className="svx-partner__dashboard">
    <div className="svx-partner__heading"><div><span className="svx-partner__eyebrow">ÁREA DO PARCEIRO</span><h1>Olá, {dashboard.partner.name}.</h1><p>Indicações são separadas entre cadastros, pagamentos confirmados e repasses.</p></div><div><button type="button" onClick={()=>void load()}><RefreshCcw size={16}/> Atualizar</button><button type="button" onClick={()=>void logout()}><LogOut size={16}/> Sair</button></div></div>
    {dashboard.partner.status!=='active'&&<p role="status" className="svx-partner__warning"><ShieldCheck size={16}/> {dashboard.partner.status==='pending'?'Seu código está reservado. Aguarde a ativação administrativa para compartilhar o link.':'Conta suspensa. Entre em contato com o suporte.'}</p>}
    <div className="svx-partner__grid">
     {[['Visitas ao código',dashboard.metrics.visits.toLocaleString('pt-BR')],['Cadastros atribuídos',dashboard.metrics.registered.toLocaleString('pt-BR')],['Sem Checkout',Number(dashboard.metrics.registeredOnly||0).toLocaleString('pt-BR')],['Checkout iniciado',Number(dashboard.metrics.checkoutStarted||0).toLocaleString('pt-BR')],['Assinaturas pagas',dashboard.metrics.qualified.toLocaleString('pt-BR')],['Comissões elegíveis',money.format(dashboard.metrics.earnedCents/100)],['Pagamentos registrados',money.format(dashboard.metrics.paidCents/100)]].map(([label,value])=><article key={label}><small>{label}</small><strong>{value}</strong></article>)}
    </div>
    <section className="svx-partner__card"><h2>Seu código e link de indicação</h2>{code?<><code>{code}</code>{canShare?<><p className="svx-partner__ref-link">{link}</p><button type="button" onClick={()=>void copy(link,'link')}><Copy size={17}/> Copiar link</button><button type="button" onClick={()=>void copy(code,'código')}><Copy size={17}/> Copiar código</button></>:<p>Código reservado. O link começa a funcionar após a ativação.</p>}</>:<p>Nenhum código disponível para esta conta.</p>}<small>O link identifica automaticamente as lojas indicadas. Visitas não são vendas; comissões exigem primeiro pagamento confirmado pela Stripe e regra administrativa.</small></section>
    <section className="svx-partner__card"><h2>Recebimento</h2><p>Cadastre a chave Pix para conferência. O portal não realiza transferências automaticamente.</p><form className="svx-partner__inline" onSubmit={updatePix}><input maxLength={160} value={form.pixKey} onChange={e=>setForm(x=>({...x,pixKey:e.target.value}))} placeholder={dashboard.partner.pixKey?'Chave cadastrada: '+dashboard.partner.pixKey:'Sua chave Pix'} required/><button disabled={busy}>Salvar</button></form><small>Comissão configurada: {dashboard.partner.commissionCents?money.format(dashboard.partner.commissionCents/100)+' por conversão qualificada':'Pendente de definição administrativa'}</small></section>
    <section className="svx-partner__card"><h2>Histórico de indicações</h2>{dashboard.referrals.length?<div className="svx-partner__history">{dashboard.referrals.map((row,i)=><article key={i}><div><strong>{row.storeName}</strong><span>{date.format(new Date(row.createdAt))}</span></div><div><b>{row.status==='reversed'?'Pagamento estornado':row.status==='qualified'?'Pagamento confirmado':row.checkoutStartedAt?'Checkout iniciado · aguardando pagamento':'Cadastrou · não iniciou Checkout'}</b><small>{row.commissionStatus==='paid'?'Repasse registrado':row.commissionStatus==='reversal_due'?'Revisão de estorno':row.commissionStatus==='awaiting_rule'?'Regra de comissão pendente':'Repasse pendente ou em análise'}</small></div><strong>{money.format(Number(row.commissionCents)/100)}</strong></article>)}</div>:<p>Nenhuma indicação atribuída até agora.</p>}</section>
    {notice&&<p role="status" className="svx-partner__notice"><CheckCircle2 size={16}/>{notice}</p>}
    {error&&<p role="alert" className="svx-partner__error">{error}</p>}
   </div>}
 </main>
}
