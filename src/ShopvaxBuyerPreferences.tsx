import { useEffect, useState } from 'react'
import { BellOff, CheckCircle2, Mail, MessageCircle } from 'lucide-react'
import { apiRequest } from './api'
import { listenAuthChanges } from './auth-session-sync'
import './shopvax-growth.css'

type Store = { id: string; slug: string; name: string }
type Preferences = { whatsapp: boolean; email: boolean; scope: 'selected' | 'all_current'; storeIds: string[]; updatedAt: string | null }

export default function ShopvaxBuyerPreferences() {
  const storeSlug = window.location.pathname.split('/').filter(Boolean)[1] || ''
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fetchPrefs = async () => {
    try {
      const [value, available] = await Promise.all([
        apiRequest<Preferences>('/api/public/store/' + encodeURIComponent(storeSlug) + '/growth/consent'),
        apiRequest<{ stores: Store[] }>('/api/public/growth/stores'),
      ])
      setPrefs(value)
      setStores(available.stores)
    } catch { setPrefs(null) }
  }
  useEffect(() => {
    void fetchPrefs()
    const stop = listenAuthChanges('customer', () => { setPrefs(null); void fetchPrefs() })
    const onFocus = () => { if (document.visibilityState === 'visible') void fetchPrefs() }
    window.addEventListener('focus', onFocus)
    return () => { stop(); window.removeEventListener('focus', onFocus) }
  }, [storeSlug])
  if (!prefs) return null
  const setChannel = (key: 'email' | 'whatsapp', checked: boolean) => setPrefs({ ...prefs, [key]: checked })
  const changeStore = (id: string, checked: boolean) => setPrefs({ ...prefs, storeIds: checked ? [...prefs.storeIds, id] : prefs.storeIds.filter(value => value !== id) })
  const save = async (revoke = false) => {
    setBusy(true); setError(''); setSuccess('')
    try {
      if (revoke) {
        await apiRequest('/api/public/store/' + encodeURIComponent(storeSlug) + '/growth/consent', { method: 'DELETE' })
        setPrefs({ whatsapp: false, email: false, scope: 'selected', storeIds: [], updatedAt: new Date().toISOString() })
        setSuccess('Permissões canceladas e cancelamento registrado.')
      } else {
        const result = await apiRequest<Preferences>('/api/public/store/' + encodeURIComponent(storeSlug) + '/growth/consent', {
          method: 'PUT', body: JSON.stringify(prefs),
        })
        setPrefs({ ...prefs, ...result, updatedAt: new Date().toISOString() })
        setSuccess('Suas escolhas foram registradas. Nenhuma mensagem foi enviada.')
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar sua escolha.') }
    finally { setBusy(false) }
  }
  return <section className="svx-buyer-preferences" aria-labelledby="svx-consent-title">
    <span className="svx-kicker">CONTROLE DO COMPRADOR</span><h2 id="svx-consent-title">Preferências de ofertas</h2>
    <p>Pedidos e conta não autorizam anúncios automaticamente. Estas permissões são opcionais, independentes e podem ser retiradas a qualquer momento.</p>
    <div className="svx-buyer-preferences__channels">
      <label><input type="checkbox" checked={prefs.whatsapp} onChange={e => setChannel('whatsapp', e.target.checked)}/><MessageCircle size={18}/> Ofertas por WhatsApp</label>
      <label><input type="checkbox" checked={prefs.email} onChange={e => setChannel('email', e.target.checked)}/><Mail size={18}/> Ofertas por e-mail</label>
    </div>
    <fieldset><legend>De quais lojas?</legend>
      <label><input type="radio" name="svx-preference-scope" checked={prefs.scope === 'all_current'} onChange={() => setPrefs({ ...prefs, scope: 'all_current', storeIds: stores.map(s => s.id) })}/> Todas as lojas disponíveis agora ({stores.length})</label>
      <label><input type="radio" name="svx-preference-scope" checked={prefs.scope === 'selected'} onChange={() => setPrefs({ ...prefs, scope: 'selected', storeIds: [] })}/> Quero selecionar lojas</label>
      {prefs.scope === 'selected' && <div className="svx-buyer-preferences__stores">{stores.map(store => <label key={store.id}><input type="checkbox" checked={prefs.storeIds.includes(store.id)} onChange={e => changeStore(store.id, e.target.checked)}/>{store.name}</label>)}{!stores.length && <p>Não há lojas disponíveis para selecionar no momento.</p>}</div>}
    </fieldset>
    <p className="svx-buyer-preferences__note">“Todas” inclui somente as lojas listadas no momento da confirmação; novas lojas exigem uma nova escolha. O sistema não dispara mensagens. Cada alteração fica registrada.</p>
    <div className="svx-buyer-preferences__actions">
      <button type="button" disabled={busy} onClick={() => void save()}><CheckCircle2 size={16}/> {busy ? 'Salvando…' : 'Salvar minhas preferências'}</button>
      <button type="button" disabled={busy} onClick={() => void save(true)}><BellOff size={16}/> Cancelar todas as ofertas</button>
    </div>
    {prefs.updatedAt && <small>Última preferência registrada: {new Date(prefs.updatedAt).toLocaleString('pt-BR')}.</small>}
    {error && <p className="svx-growth-error" role="alert">{error}</p>}{success && <p className="svx-growth-success" role="status">{success}</p>}
  </section>
}
