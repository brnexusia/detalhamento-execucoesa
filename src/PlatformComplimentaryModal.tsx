import { useState } from 'react'
import GoogleSignInButton from './GoogleSignInButton'
import { apiRequest } from './api'
import './platform-complimentary.css'

type Plan = { code:string; name:string; active:boolean; isSystem:boolean }
type Store = {
  id:string;name:string;planCode:string;isActive:boolean;
  adminAccessActive?:boolean;adminAccessExpiresAt?:string|null
}

export default function PlatformComplimentaryModal({
  store, plans, auth, onClose, onSaved,
}:{
  store:Store; plans:Plan[];
  auth:{hasPassword:boolean;hasGoogle:boolean};
  onClose:()=>void;onSaved:()=>Promise<void>
}){
  const revoke=store.adminAccessActive===true
  const [planCode,setPlanCode]=useState(store.planCode)
  const [duration,setDuration]=useState('30')
  const [reason,setReason]=useState('')
  const [confirmation,setConfirmation]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const confirmationWord=revoke?'REVOGAR':'LIBERAR'
  const reasonValid=revoke || reason.trim().length>=10
  const confirmationValid=confirmation===confirmationWord
  const googleDisabled=busy || !confirmationValid || !reasonValid
  const googleDisabledMessage=!reasonValid
    ? 'Descreva o motivo da cortesia (mínimo de 10 caracteres).'
    : !confirmationValid
      ? 'Digite '+confirmationWord+' no campo acima para ativar o Google.'
      : 'Confirmação indisponível no momento.'

  const submit=async (credential?:string)=>{
    if(confirmation!==confirmationWord) {setError('Digite '+confirmationWord+' para confirmar.');return}
    if(!revoke && reason.trim().length<10) {setError('Informe um motivo com pelo menos 10 caracteres.');return}
    setBusy(true);setError('')
    try {
      await apiRequest('/api/platform/stores/'+encodeURIComponent(store.id)+'/complimentary-access',{
        method:'PATCH',
        body:JSON.stringify({
          action:revoke?'revoke':'grant',
          planCode,durationDays:duration==='unlimited'?'unlimited':Number(duration),
          reason:reason.trim(),confirmation,
          ...(credential?{googleCredential:credential}:{password}),
        }),
      })
      await onSaved()
    }catch(err){setError(err instanceof Error?err.message:'Não foi possível modificar a cortesia.')}
    finally{setBusy(false)}
  }

  return <div className="platform-complimentary-layer" role="presentation">
    <button type="button" className="platform-complimentary-backdrop" onClick={onClose} aria-label="Fechar janela de cortesia"/>
    <section className="platform-complimentary" role="dialog" aria-modal="true" aria-labelledby="complimentary-title">
      <header>
        <div><span>GESTÃO DE ACESSO</span><h2 id="complimentary-title">{revoke?'Revogar acesso gratuito':'Liberar sem pagamento'}</h2></div>
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </header>
      <form onSubmit={e=>{e.preventDefault();if(auth.hasPassword)void submit()}}>
        <div className="platform-complimentary-body">
          <p>Loja: <strong>{store.name}</strong>. {revoke
            ? 'Após revogar, o acesso volta a depender de pagamento confirmado, se não houver assinatura paga.'
            : 'Liberação administrativa excepcional. Não cria assinatura nem cobrança na Stripe; as outras lojas continuam pagando normalmente.'}</p>
          {!revoke&&<>
            <label>Plano liberado
              <select value={planCode} onChange={e=>setPlanCode(e.target.value)}>
                {plans.filter(p=>p.isSystem&&p.active).map(p=><option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label>Duração
              <select value={duration} onChange={e=>setDuration(e.target.value)}>
                <option value="7">7 dias</option>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">365 dias</option>
                <option value="unlimited">Sem prazo (até revogar)</option>
              </select>
            </label>
            <label>Motivo da cortesia
              <textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={300} rows={3} placeholder="Ex.: conta de demonstração ou parceria autorizada" required/>
            </label>
          </>}
          <div className="platform-complimentary-warning">{revoke
            ? 'A revogação não cancela assinaturas ou faturas Stripe existentes.'
            : 'O prazo começa imediatamente. Ao terminar, a conta volta a exigir pagamento. Tentativas anteriores de pagamento não são canceladas automaticamente.'}</div>
          <label>Confirme digitando <strong>{confirmationWord}</strong>
            <input value={confirmation} onChange={e=>setConfirmation(e.target.value.toUpperCase())} autoComplete="off" placeholder={confirmationWord} required/>
          </label>
          {auth.hasPassword&&<label>Senha administrativa
            <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
          </label>}
          {auth.hasGoogle&&<div className="platform-complimentary-google">
            <p>{auth.hasPassword?'Ou confirme a identidade com Google':'Para habilitar o botão Google, preencha os campos acima. Depois, confirme sua identidade.'}</p>
            <GoogleSignInButton
              mode="login"
              disabled={googleDisabled}
              processing={busy}
              disabledMessage={googleDisabledMessage}
              onCredential={credential=>void submit(credential)}
              onUnavailable={setError}
            />
          </div>}
          {error&&<p className="platform-complimentary-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" onClick={onClose}>Cancelar</button>
          {auth.hasPassword&&<button type="submit" className={revoke?'is-revoke':'is-grant'} disabled={busy||confirmation!==confirmationWord||!password||(!revoke&&reason.trim().length<10)}>{busy?'Salvando…':revoke?'Revogar cortesia':'Liberar acesso'}</button>}
        </footer>
      </form>
    </section>
  </div>
}
