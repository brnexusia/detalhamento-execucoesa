import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { apiRequest } from './api'
import { notifyAuthChange } from './auth-session-sync'

// The component name is retained for old imports, but the buyer login is now
// phone + password. A WhatsApp verification code is never requested.
type Buyer = { phone:string;name:string;document?:string;cnpj?:string;profileCompleted:boolean }
type Stage = 'login' | 'register' | 'profile'
const cleanDocument = (value:string) => value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,14)
const validPhone = (value:string) => {
  const digits=value.replace(/\D/g,'')
  return (digits.startsWith('55')?digits.length===12||digits.length===13:digits.length===10||digits.length===11)
}
export default function BuyerWhatsappLogin({storeSlug='',onVerified,editOnly=false}:{
  storeSlug?:string
  onVerified:()=>Promise<boolean>
  editOnly?:boolean
}){
  const [open,setOpen]=useState(!editOnly)
  const [stage,setStage]=useState<Stage>(editOnly?'profile':'login')
  const [phone,setPhone]=useState('')
  const [password,setPassword]=useState('')
  const [showPassword,setShowPassword]=useState(false)
  const [name,setName]=useState('')
  const [document,setDocument]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

  useEffect(()=>{
    let active=true
    setOpen(!editOnly)
    setStage(editOnly?'profile':'login')
    setError('')
    apiRequest<{buyer:Buyer}>('/api/public/buyer-auth/me')
      .then(({buyer})=>{
        if(!active)return
        setPhone(buyer.phone)
        setName(buyer.name||'')
        setDocument(cleanDocument(buyer.document||buyer.cnpj||''))
        if(!buyer.profileCompleted||editOnly)setStage('profile')
      })
      .catch(()=>undefined)
    return()=>{active=false}
  },[storeSlug,editOnly])

  const act=async(action:()=>Promise<void>)=>{
    if(busy)return
    setBusy(true);setError('')
    try{await action()}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível continuar. Tente novamente.')}
    finally{setBusy(false)}
  }
  const login=()=>void act(async()=>{
    const result=await apiRequest<{buyer:Buyer}>('/api/public/buyer-auth/login-password',{
      method:'POST',body:JSON.stringify({phone,password}),
    })
    setPassword('')
    if(!result.buyer.profileCompleted){
      setName(result.buyer.name||'')
      setDocument(cleanDocument(result.buyer.document||result.buyer.cnpj||''))
      setStage('profile')
      return
    }
    notifyAuthChange('customer')
    await onVerified()
  })
  const register=()=>void act(async()=>{
    await apiRequest<{buyer:Buyer}>('/api/public/buyer-auth/register-password',{
      method:'POST',body:JSON.stringify({name:name.trim(),document:cleanDocument(document),phone,password}),
    })
    setPassword('')
    // This association only records a new account's original storefront.
    // Buyer accounts remain global; existing data is never claimed by phone.
    if(storeSlug){
      await apiRequest('/api/public/buyer-auth/attribute-origin',{
        method:'POST',body:JSON.stringify({storeSlug}),
      }).catch(()=>undefined)
    }
    notifyAuthChange('customer')
    await onVerified()
  })
  const save=()=>void act(async()=>{
    await apiRequest('/api/public/buyer-auth/profile',{
      method:'PUT',body:JSON.stringify({name:name.trim(),document:cleanDocument(document)}),
    })
    notifyAuthChange('customer')
    if(editOnly)setOpen(false)
    await onVerified()
  })
  const changeStage=(next:Stage)=>{
    setError('')
    setPassword('')
    setStage(next)
  }
  if(editOnly&&!open)return <button type="button" className="buyer-profile-open" onClick={()=>setOpen(true)}>Editar dados do comprador</button>

  return <section className="customer-card customer-auth buyer-whatsapp-auth">
    <div className="buyer-whatsapp-title">
      <ShieldCheck size={24} aria-hidden="true"/>
      <div><small>{editOnly?'Minha conta':'ShopVax · Comprador'}</small>
        <h1>{stage==='register'?'Criar conta':stage==='profile'?'Editar meus dados':'Entrar na minha conta'}</h1>
        <p>{stage==='login'?'Acesse com seu telefone e senha. Não enviamos código por WhatsApp.':
          stage==='register'?'Cadastre-se uma vez para consultar preços e acompanhar pedidos em todas as lojas.':
          'Atualize seus dados sem alterar seu telefone de acesso.'}</p>
      </div>
    </div>
    {!editOnly&&stage!=='profile'&&<div className="buyer-password-tabs" role="group" aria-label="Acesso de comprador">
      <button type="button" className={stage==='login'?'is-active':''} aria-pressed={stage==='login'} onClick={()=>changeStage('login')}>Entrar</button>
      <button type="button" className={stage==='register'?'is-active':''} aria-pressed={stage==='register'} onClick={()=>changeStage('register')}>Criar conta</button>
    </div>}
    {stage!=='profile'&&<form onSubmit={event=>{event.preventDefault();stage==='register'?register():login()}}>
      {stage==='register'&&<>
        <label><span>Nome completo</span><input autoComplete="name" maxLength={120} minLength={2} required value={name} onChange={event=>setName(event.target.value)}/></label>
        <label><span>CPF ou CNPJ</span><input autoComplete="off" inputMode="text" maxLength={18} placeholder="CPF ou CNPJ" required value={document} onChange={event=>setDocument(cleanDocument(event.target.value))}/></label>
      </>}
      <label><span>Telefone com DDD</span><input type="tel" inputMode="tel" autoComplete="tel" placeholder="(71) 99999-9999" maxLength={20} required value={phone} onChange={event=>setPhone(event.target.value)}/></label>
      <label><span>Senha</span><span className="buyer-password-input"><input type={showPassword?'text':'password'} autoComplete={stage==='login'?'current-password':'new-password'} minLength={stage==='login'?undefined:10} maxLength={128} required value={password} onChange={event=>setPassword(event.target.value)} placeholder={stage==='register'?'Pelo menos 10 caracteres':'Sua senha'}/><button type="button" aria-label={showPassword?'Ocultar senha':'Mostrar senha'} onClick={()=>setShowPassword(show=>!show)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
      {stage==='register'&&<p className="buyer-simple-privacy">Telefone usado para acessar sua conta; não é verificado por mensagem. Ao criar sua conta, você concorda com nossos <a href="/termos-de-uso.html" target="_blank" rel="noopener noreferrer">Termos de Uso</a> e pode consultar a <a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>.</p>}
      <button type="submit" className="customer-submit" disabled={busy||!validPhone(phone)||!password||(stage==='register'&&(name.trim().length<2||![11,14].includes(cleanDocument(document).length)||password.length<10))}><CheckCircle2 size={17}/>{busy?'Aguarde…':stage==='register'?'Criar minha conta':'Entrar e ver preços'}</button>
    </form>}
    {stage==='profile'&&<form onSubmit={event=>{event.preventDefault();save()}}>
      <label><span>Nome completo</span><input autoComplete="name" maxLength={120} minLength={2} required value={name} onChange={event=>setName(event.target.value)}/></label>
      <label><span>CPF ou CNPJ</span><input autoComplete="off" inputMode="text" maxLength={18} required value={document} onChange={event=>setDocument(cleanDocument(event.target.value))}/></label>
      <label><span>Telefone cadastrado</span><input type="tel" autoComplete="off" value={phone} readOnly aria-readonly="true"/></label>
      <p className="buyer-simple-privacy">Seus dados identificam a conta e os pedidos. Consulte a <a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">política de privacidade</a>.</p>
      <button type="submit" className="customer-submit" disabled={busy||name.trim().length<2||![11,14].includes(cleanDocument(document).length)}>{busy?'Salvando…':'Salvar meus dados'}</button>
      {editOnly&&<button type="button" className="buyer-secondary" onClick={()=>setOpen(false)}>Cancelar</button>}
    </form>}
    {error&&<div role="alert" className="customer-error">{error}</div>}
  </section>
}
