import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, Handshake, LogOut, RefreshCcw, ShieldCheck, Share2, ExternalLink, Link2, Wallet, History, CircleDollarSign, ShoppingCart, MousePointerClick, UserPlus, Banknote, Store, ShieldAlert } from 'lucide-react'
import { apiRequest } from './api'
import { publicReferralLink } from './public-share-links'
import './partner-portal.css'

type Partner = {name:string;email:string;code:string|null;status:string;commissionCents:number;pixKey:string;createdAt:string}
type Referral = {storeName:string;status:string;createdAt:string;qualifiedAt:string|null;commissionCents:number;commissionStatus:string;paidAt:string|null;checkoutStartedAt:string|null}
type Dashboard = {partner:Partner;metrics:{visits:number;registered:number;qualified:number;pending:number;registeredOnly:number;checkoutStarted:number;earnedCents:number;paidCents:number};referrals:Referral[];referralsPage?:number;referralsLimit?:number;referralsTotal?:number}
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'})
const routeBase=window.location.pathname.startsWith('/afiliados')?'/afiliados':'/parceiros'
function go(path:string){window.history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'))}
export default function ShopvaxPartnerPortal(){
 const [mode,setMode]=useState<'login'|'register'>(window.location.pathname.endsWith('/cadastro')?'register':'login')
 const [existingAccount,setExistingAccount]=useState(false)
 const [form,setForm]=useState({name:'',email:'',password:'',pixKey:''})
 const [dashboard,setDashboard]=useState<Dashboard|null>(null)
 const [loading,setLoading]=useState(true)
 const [loadFailure,setLoadFailure]=useState('')
 const [paging,setPaging]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const load=async(page=1):Promise<boolean>=>{
   setPaging(true)
   try{
     const result=await apiRequest<Dashboard>('/api/partners/dashboard'+(page>1?'?page='+page:''))
     if(!result?.partner)throw new Error('Resposta de sessão de parceiro inválida.')
     setDashboard(result);setForm(current=>({...current,pixKey:result.partner.pixKey||''}));setError('');setLoadFailure('');return true
   }catch(err){
     const status=(err as Error & {status?:number})?.status
     if(status===401||status===403)setDashboard(null)
     else if(!dashboard)setLoadFailure(err instanceof Error?err.message:'Não foi possível carregar o painel.')
     else setError('Não foi possível atualizar o painel. Seus dados anteriores permanecem visíveis.')
     return false
   }
   finally{setLoading(false);setPaging(false)}
 }
 useEffect(()=>{void load()},[])
 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();setBusy(true);setError('')
  try{
   const result=await apiRequest<{ok:boolean;code?:string}>('/api/partners/'+(mode==='register'?'register':'login'),{method:'POST',body:JSON.stringify({name:form.name,email:form.email,password:form.password})})
   if(result?.ok!==true)throw new Error('O servidor não confirmou a operação. Verifique se o backend do ShopVax está publicado e acessível.')
   const signedIn=await load()
   if(!signedIn){
     if(mode==='register'){setMode('login');go(routeBase+'/entrar')}
     throw new Error(mode==='register'?'Conta cadastrada, mas a sessão não abriu. Entre com o e-mail e a senha que acabou de cadastrar.':'Não foi possível abrir seu painel. Tente entrar novamente.')
   }
   setForm(x=>({...x,password:''}))
   if(mode==='register')setNotice('Conta criada! Seu código e link já estão vinculados à sua conta.')
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível acessar o programa.')}
  finally{setBusy(false)}
 }
 const logout=async()=>{
  setBusy(true);setError('')
  try{
    await apiRequest<{ok:boolean}>('/api/partners/logout',{method:'POST'})
    setDashboard(null);setMode('login');setForm(current=>({...current,password:''}));go(routeBase+'/entrar')
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível encerrar sua sessão. Tente novamente.')}
  finally{setBusy(false)}
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
 const share=async()=>{
   if(!link)return
   if(typeof navigator.share!=='function')return copy(link,'link')
   try{await navigator.share({title:'Minha indicação Shopvax',text:'Conheça o Shopvax para sua loja',url:link})}
   catch(err){if((err as Error)?.name!=='AbortError')setError('Não foi possível compartilhar. Use Copiar link.')}
 }
 const historyPage=dashboard?.referralsPage||1
 const historyTotal=dashboard?.referralsTotal??dashboard?.metrics.registered??0
 const historyPages=Math.max(1,Math.ceil(historyTotal/(dashboard?.referralsLimit||30)))
 const code=dashboard?.partner.code || ''
 const canShare=dashboard?.partner.status==='active'
 const link=code&&canShare?publicReferralLink(code):''
 const copy=async(value:string,kind:'código'|'link')=>{
   setError('')
   try{
     if(!navigator.clipboard?.writeText)throw new Error('Área de transferência indisponível.')
     await navigator.clipboard.writeText(value)
     setNotice((kind==='link'?'Link':'Código')+' copiado!')
   }catch{setError('Não foi possível copiar automaticamente. Selecione o '+kind+' exibido e copie manualmente.')}
 }
 return <main className="svx-partner svx-partner--redesign">
  <header className="svx-partner__top"><a href="/" className="svx-partner__brand"><img src="/brand/shopvax-symbol.svg" alt="" aria-hidden="true"/><img src="/brand/shopvax-wordmark.svg" alt="Shopvax"/><span>Parceiros</span></a><span><Handshake size={18}/> Programa de indicações</span></header>
  {loading?<p>Carregando área de parceiros…</p>:!dashboard&&loadFailure?
    <section className="svx-partner__auth"><h1>Não foi possível abrir o portal.</h1><p role="alert" className="svx-partner__error">{loadFailure}</p><button type="button" onClick={()=>{setLoadFailure('');setLoading(true);void load()}}>Tentar novamente <RefreshCcw size={16}/></button></section>
    :!dashboard?
   <section className="svx-partner__auth">
    <span className="svx-partner__eyebrow">PORTAL INDEPENDENTE</span>
    <h1>{mode==='register'?'Seja parceiro ShopVax.':'Acesse seu painel de indicações.'}</h1>
    <p>Indique lojistas. A conversão somente é reconhecida após o primeiro pagamento confirmado pela Stripe. Os valores das comissões são definidos e aprovados pela administração.</p>
    <form onSubmit={submit}>
     {mode==='register'&&!existingAccount&&<label>Nome completo<input required maxLength={120} autoComplete="name" value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))}/></label>}
     <label>E-mail<input required type="email" autoComplete="email" value={form.email} onChange={e=>setForm(x=>({...x,email:e.target.value}))}/></label>
     <label>Senha<input required type="password" minLength={mode==='register'?(existingAccount?8:12):1} maxLength={200} autoComplete={mode==='register'?'new-password':'current-password'} value={form.password} onChange={e=>setForm(x=>({...x,password:e.target.value}))}/></label>
     {mode==='register'&&<label className="svx-partner__existing-account"><input type="checkbox" checked={existingAccount} onChange={e=>setExistingAccount(e.target.checked)}/><span>Já tenho uma conta de lojista no ShopVax e quero usar o mesmo e-mail e senha.</span></label>}
     {error&&<p role="alert" className="svx-partner__error">{error}</p>}
     <button disabled={busy}>{busy?'Processando…':mode==='register'?'Criar conta de parceiro':'Entrar como parceiro'} <ArrowRight size={17}/></button>
    </form>
    <button className="svx-partner__link" type="button" onClick={()=>{const next=mode==='login'?'register':'login';setMode(next);go(routeBase+'/'+(next==='login'?'entrar':'cadastro'))}}>{mode==='login'?'Ainda não é parceiro? Cadastre-se':'Já tem cadastro? Entre'}</button>
   </section>:
   <div className="svx-partner__dashboard">
    <div className="svx-partner__heading"><div><span className="svx-partner__eyebrow">ÁREA DO PARCEIRO</span><h1>Olá, {dashboard.partner.name}.</h1><p>Acompanhe suas indicações, conversões pagas e comissões em um só lugar.</p></div><div><button type="button" disabled={paging} onClick={()=>void load(historyPage)}><RefreshCcw size={16}/> Atualizar</button><button type="button" disabled={busy} onClick={()=>void logout()}><LogOut size={16}/> Sair</button></div></div>
    {dashboard.partner.status!=='active'&&<p role="status" className="svx-partner__warning"><ShieldCheck size={16}/> {dashboard.partner.status==='pending'?'Seu código está reservado. Aguarde a ativação administrativa para compartilhar o link.':'Conta suspensa. Entre em contato com o suporte.'}</p>}
    <div className="svx-partner__grid svx-partner__grid--outcomes">
     {[
      {label:'Conversões concluídas',value:dashboard.metrics.qualified.toLocaleString('pt-BR'),Icon:CircleDollarSign,note:'Primeiro pagamento confirmado',paid:true},
      {label:'Comissões elegíveis',value:money.format(dashboard.metrics.earnedCents/100),Icon:Banknote,note:'Total das conversões qualificadas'},
      {label:'Repasses registrados',value:money.format(dashboard.metrics.paidCents/100),Icon:Wallet,note:'Pagamentos externos registrados'}
     ].map(({label,value,Icon,note,paid})=><article key={label} className={paid?'is-paid':''}><small><Icon size={19}/>{label}</small><strong>{value}</strong><span>{note}</span></article>)}
    </div>
    <section className="svx-partner__activity" aria-label="Atividade das indicações">
     <h2>Atividade das indicações</h2>
     <div className="svx-partner__grid svx-partner__grid--activity">
      {[
       {label:'Visitas ao código',value:dashboard.metrics.visits,Icon:MousePointerClick},
       {label:'Cadastros atribuídos',value:dashboard.metrics.registered,Icon:UserPlus},
       {label:'Sem Checkout',value:dashboard.metrics.registeredOnly||0,Icon:Store},
       {label:'Checkout pendente',value:dashboard.metrics.checkoutStarted||0,Icon:ShoppingCart}
      ].map(({label,value,Icon})=><article key={label}><small><Icon size={17}/>{label}</small><strong>{Number(value).toLocaleString('pt-BR')}</strong></article>)}
     </div>
     <small>Visitas, cadastros e checkouts pendentes não são conversões concluídas.</small>
    </section>
    <div className="svx-partner__tools">
    <section className="svx-partner__card"><h2><Link2 size={21}/> Seu código e link de indicação</h2><p>Compartilhe seu link para vincular novas lojas à sua conta.</p>{code?<><div className="svx-partner__ref-box"><span>Seu código</span><code>{code}</code>{canShare&&<><span>Link de indicação</span><a className="svx-partner__ref-link" href={link} target="_blank" rel="noopener noreferrer"><span>{link}</span><ExternalLink size={14}/></a></>}</div>{canShare?<div className="svx-partner__share-actions"><button className="svx-partner__primary" type="button" onClick={()=>void copy(link,'link')}><Copy size={17}/> Copiar link</button><button className="svx-partner__secondary" type="button" onClick={()=>void copy(code,'código')}><Copy size={17}/> Copiar código</button><button className="svx-partner__secondary" type="button" onClick={()=>void share()}><Share2 size={17}/> Compartilhar</button></div>:<p>Código reservado. O link começa a funcionar após a ativação.</p>}</>:<p>Nenhum código disponível para esta conta.</p>}</section>
    <section className="svx-partner__card"><h2><Wallet size={21}/> Recebimento</h2><p>Cadastre a chave Pix para conferência. O portal não realiza transferências automaticamente.</p><form className="svx-partner__inline" onSubmit={updatePix}><input aria-label="Chave Pix" maxLength={160} value={form.pixKey} onChange={e=>setForm(x=>({...x,pixKey:e.target.value}))} placeholder={dashboard.partner.pixKey?'Chave cadastrada: '+dashboard.partner.pixKey:'Sua chave Pix'} required/><button className="svx-partner__primary" disabled={busy}>Salvar</button></form><small>Comissão configurada: {dashboard.partner.commissionCents?money.format(dashboard.partner.commissionCents/100)+' por primeira conversão paga':'Pendente de definição administrativa'}</small></section></div>
    <section className="svx-partner__card"><h2><History size={21}/> Histórico de indicações</h2>{dashboard.referrals.length?<div className="svx-partner__history">{dashboard.referrals.map((row,i)=><article key={i}><div><strong>{row.storeName}</strong><span>{date.format(new Date(row.createdAt))}</span></div><div><b>{row.status==='reversed'?'Pagamento estornado':row.status==='qualified'?'Pagamento confirmado':row.checkoutStartedAt?'Checkout iniciado · aguardando pagamento':'Cadastrou · não iniciou Checkout'}</b><small>{row.status==='pending'?'Aguardando primeiro pagamento':row.commissionStatus==='paid'?'Repasse registrado':row.commissionStatus==='reversal_due'?'Revisão de estorno':row.commissionStatus==='awaiting_rule'?'Regra de comissão pendente':'Repasse pendente ou em análise'}</small></div><strong>{row.status==='pending'?'—':money.format(Number(row.commissionCents)/100)}</strong></article>)}</div>:<div className="svx-partner__empty"><Store size={24}/><strong>Nenhuma indicação atribuída até agora.</strong><span>As lojas vinculadas ao seu código aparecerão aqui com o status de pagamento e repasse.</span></div>}<div className="svx-partner__pagination">
      <small>{historyTotal.toLocaleString('pt-BR')} {historyTotal===1?'loja indicada':'lojas indicadas'} · página {historyPage} de {historyPages}</small>
      <div><button type="button" disabled={paging||historyPage<=1} onClick={()=>void load(historyPage-1)}>Anterior</button><button type="button" disabled={paging||historyPage>=historyPages} onClick={()=>void load(historyPage+1)}>Próxima página</button></div>
     </div></section>
    <p className="svx-partner__warning"><ShieldAlert size={18}/> A indicação só é concluída após o primeiro pagamento de valor positivo confirmado pela Stripe. O portal não realiza repasses automaticamente.</p>
    {notice&&<p role="status" className="svx-partner__notice"><CheckCircle2 size={16}/>{notice}</p>}
    {error&&<p role="alert" className="svx-partner__error">{error}</p>}
   </div>}
 </main>
}
