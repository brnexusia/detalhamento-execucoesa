import { useEffect, useMemo, useState } from 'react'
import { Check, CircleAlert, Copy, CreditCard, ExternalLink, KeyRound, Link2, PackageCheck, Plus, RefreshCcw, Save, ShieldCheck, Trash2, Truck, Webhook } from 'lucide-react'
import './phase4-panel.css'

type Integration = {
  asaas: {
    enabled: boolean
    environment: 'sandbox' | 'production'
    apiKeyConfigured: boolean
    apiKeyLast4: string
    paymentMethods: string[]
    webhookConfigured: boolean
    webhookUrl: string
  }
  shippingEnabled: boolean
  meta: { enabled: boolean; brand: string; feedUrl: string }
  erpApiEnabled: boolean
}

type ShippingRule = {
  id: string
  name: string
  states: string[]
  cepPrefixes: string[]
  amount: number
  freeOver: number | null
  minSubtotal: number
  deliveryDaysMin: number
  deliveryDaysMax: number
  active: boolean
}

type ApiToken = { id: string; name: string; tokenPrefix: string; scopes: string[]; active: boolean; lastUsedAt?: string | null; createdAt: string }
type ErpWebhook = { id: string; name: string; url: string; events: string[]; active: boolean; createdAt: string }
type Phase4Data = {
  plan: { code: string; name: string }
  eligible: boolean
  reason?: string
  integration?: Integration
  shippingRules?: ShippingRule[]
  apiTokens?: ApiToken[]
  erpWebhooks?: ErpWebhook[]
  payments?: Array<{ id: string; external_id: string; billing_type: string; status: string; value: number; invoice_url: string; created_at: string }>
}

type SecretNotice = { title: string; value: string; note: string } | null

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
  return payload as T
}

export default function Phase4Panel() {
  const [data, setData] = useState<Phase4Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secret, setSecret] = useState<SecretNotice>(null)

  const [asaasEnabled, setAsaasEnabled] = useState(false)
  const [asaasEnvironment, setAsaasEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [asaasKey, setAsaasKey] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<string[]>(['PIX', 'BOLETO', 'CREDIT_CARD'])
  const [shippingEnabled, setShippingEnabled] = useState(false)
  const [metaEnabled, setMetaEnabled] = useState(false)
  const [metaBrand, setMetaBrand] = useState('')
  const [erpEnabled, setErpEnabled] = useState(false)
  const [shipping, setShipping] = useState({ name: '', states: 'BA', prefixes: '', amount: '0', freeOver: '', minSubtotal: '0', daysMin: '1', daysMax: '7' })
  const [tokenName, setTokenName] = useState('ERP principal')
  const [tokenScopes, setTokenScopes] = useState(['products:read', 'orders:read', 'payments:read'])
  const [webhookForm, setWebhookForm] = useState({ name: 'ERP', url: '', events: ['order.created', 'payment.updated'] })

  const syncForms = (next: Phase4Data) => {
    const integration = next.integration
    if (!integration) return
    setAsaasEnabled(integration.asaas.enabled)
    setAsaasEnvironment(integration.asaas.environment)
    setPaymentMethods(integration.asaas.paymentMethods)
    setShippingEnabled(integration.shippingEnabled)
    setMetaEnabled(integration.meta.enabled)
    setMetaBrand(integration.meta.brand || '')
    setErpEnabled(integration.erpApiEnabled)
  }

  const load = async () => {
    setError('')
    try {
      const next = await request<Phase4Data>('/api/admin/phase4')
      setData(next)
      syncForms(next)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar as integrações.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const integration = data?.integration
  const shippingRules = data?.shippingRules || []
  const apiTokens = data?.apiTokens || []
  const erpWebhooks = data?.erpWebhooks || []
  const recentPayments = data?.payments || []
  const paidCount = useMemo(() => recentPayments.filter((item) => item.status === 'paid').length, [recentPayments])

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    flash('Copiado.')
  }

  const saveCore = async () => {
    setSaving('core'); setError('')
    try {
      await request('/api/admin/phase4/settings', { method: 'PATCH', body: JSON.stringify({ shippingEnabled, metaEnabled, metaBrand, erpApiEnabled: erpEnabled }) })
      flash('Integrações atualizadas.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.') }
    finally { setSaving('') }
  }

  const saveAsaas = async () => {
    setSaving('asaas'); setError(''); setSecret(null)
    try {
      const payload = await request<{ integration: Integration; webhookAuthToken?: string; warning?: string | null }>('/api/admin/phase4/asaas', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: asaasEnabled, environment: asaasEnvironment, apiKey: asaasKey || undefined, paymentMethods }),
      })
      setAsaasKey('')
      if (payload.webhookAuthToken) setSecret({ title: 'Token do webhook Asaas', value: payload.webhookAuthToken, note: 'Copie agora e guarde com segurança. Este segredo não volta a ser exibido.' })
      flash('Configuração do Asaas salva.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível configurar o Asaas.') }
    finally { setSaving('') }
  }

  const provisionWebhook = async () => {
    setSaving('asaas-webhook'); setError('')
    try {
      await request('/api/admin/phase4/asaas/provision-webhook', { method: 'POST', body: '{}' })
      flash('Webhook provisionado no Asaas.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível provisionar o webhook.') }
    finally { setSaving('') }
  }

  const addShippingRule = async () => {
    setSaving('shipping'); setError('')
    try {
      await request('/api/admin/phase4/shipping-rules', {
        method: 'POST',
        body: JSON.stringify({
          name: shipping.name,
          states: shipping.states.split(',').map((item) => item.trim()).filter(Boolean),
          cepPrefixes: shipping.prefixes.split(',').map((item) => item.trim()).filter(Boolean),
          amount: Number(shipping.amount || 0),
          freeOver: shipping.freeOver === '' ? null : Number(shipping.freeOver),
          minSubtotal: Number(shipping.minSubtotal || 0),
          deliveryDaysMin: Number(shipping.daysMin || 1),
          deliveryDaysMax: Number(shipping.daysMax || 7),
          active: true,
        }),
      })
      setShipping((current) => ({ ...current, name: '', prefixes: '', amount: '0', freeOver: '' }))
      flash('Regra de frete criada.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar a regra.') }
    finally { setSaving('') }
  }

  const deleteShipping = async (rule: ShippingRule) => {
    if (!window.confirm(`Excluir a regra ${rule.name}?`)) return
    setSaving(rule.id)
    try {
      await request(`/api/admin/phase4/shipping-rules/${encodeURIComponent(rule.id)}`, { method: 'DELETE' })
      flash('Regra de frete excluída.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir.') }
    finally { setSaving('') }
  }

  const toggleScope = (scope: string) => setTokenScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])
  const createToken = async () => {
    setSaving('token'); setError(''); setSecret(null)
    try {
      const payload = await request<{ token: { secret: string; tokenPrefix: string }; warning: string }>('/api/admin/phase4/api-tokens', {
        method: 'POST', body: JSON.stringify({ name: tokenName, scopes: tokenScopes }),
      })
      setSecret({ title: 'Token da API/ERP', value: payload.token.secret, note: payload.warning })
      flash('Token criado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o token.') }
    finally { setSaving('') }
  }

  const revokeToken = async (token: ApiToken) => {
    if (!window.confirm(`Revogar ${token.name}?`)) return
    setSaving(token.id)
    try {
      await request(`/api/admin/phase4/api-tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' })
      flash('Token revogado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível revogar o token.') }
    finally { setSaving('') }
  }

  const createErpWebhook = async () => {
    setSaving('erp-webhook'); setError(''); setSecret(null)
    try {
      const payload = await request<{ webhook: { secret: string }; warning: string }>('/api/admin/phase4/erp-webhooks', {
        method: 'POST', body: JSON.stringify(webhookForm),
      })
      setSecret({ title: 'Segredo do webhook ERP', value: payload.webhook.secret, note: payload.warning })
      setWebhookForm((current) => ({ ...current, url: '' }))
      flash('Webhook ERP criado.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o webhook.') }
    finally { setSaving('') }
  }

  const deleteErpWebhook = async (webhook: ErpWebhook) => {
    if (!window.confirm(`Excluir o webhook ${webhook.name}?`)) return
    setSaving(webhook.id)
    try {
      await request(`/api/admin/phase4/erp-webhooks/${encodeURIComponent(webhook.id)}`, { method: 'DELETE' })
      flash('Webhook excluído.')
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível excluir o webhook.') }
    finally { setSaving('') }
  }

  if (loading || !data) return <div className="phase4-shell"><div className="phase4-loading"><RefreshCcw size={24}/><strong>{loading ? 'Carregando integrações…' : 'Não foi possível abrir a Fase 4.'}</strong>{error && <p>{error}</p>}</div></div>

  if (!data.eligible) return <div className="phase4-shell"><section className="phase4-locked"><ShieldCheck size={38}/><span>Fase 4 · {data.plan.name}</span><h1>Integrações avançadas</h1><p>{data.reason || 'Disponível no Plano 3.'}</p><div><CreditCard size={18}/> Asaas e pagamentos online</div><div><Truck size={18}/> Frete calculado por regras</div><div><Link2 size={18}/> Meta Shopping e API/ERP</div></section></div>

  return <div className="phase4-shell">
    <div className="phase4-title"><div><span>Fase 4 · {data.plan.name}</span><h1>Integrações e checkout</h1><p>Pagamentos, frete, catálogo Meta e integração com ERP. Dados de cartão nunca passam pelo ShopVax.</p></div><button className="phase4-secondary" onClick={load}><RefreshCcw size={16}/> Atualizar</button></div>
    {notice && <div className="phase4-notice"><Check size={16}/>{notice}</div>}
    {error && <div className="phase4-error"><CircleAlert size={17}/>{error}</div>}
    {secret && <div className="phase4-secret"><div><KeyRound size={19}/><div><strong>{secret.title}</strong><p>{secret.note}</p></div></div><code>{secret.value}</code><button onClick={() => copy(secret.value)}><Copy size={15}/> Copiar segredo</button></div>}

    <section className="phase4-card">
      <div className="phase4-card__head"><div><span>Checkout hospedado</span><h2>Asaas</h2><p>O ShopVax cria a cobrança; Pix, boleto ou cartão são concluídos na página segura do Asaas.</p></div><CreditCard size={25}/></div>
      <div className="phase4-grid phase4-grid--asaas">
        <label className="phase4-toggle"><input type="checkbox" checked={asaasEnabled} onChange={(event) => setAsaasEnabled(event.target.checked)}/><span/> Ativar pagamento online</label>
        <label className="phase4-field"><span>Ambiente</span><select value={asaasEnvironment} onChange={(event) => setAsaasEnvironment(event.target.value as 'sandbox' | 'production')}><option value="sandbox">Sandbox / testes</option><option value="production">Produção</option></select></label>
        <label className="phase4-field phase4-field--wide"><span>Chave API {integration?.asaas.apiKeyConfigured ? `(configurada · final ${integration.asaas.apiKeyLast4})` : ''}</span><input type="password" value={asaasKey} onChange={(event) => setAsaasKey(event.target.value)} placeholder={integration?.asaas.apiKeyConfigured ? 'Deixe vazio para manter a atual' : 'Cole a chave da API Asaas'}/></label>
      </div>
      <div className="phase4-checks">{['PIX','BOLETO','CREDIT_CARD'].map((method) => <label key={method}><input type="checkbox" checked={paymentMethods.includes(method)} onChange={() => setPaymentMethods((current) => current.includes(method) ? current.filter((item) => item !== method) : [...current, method])}/><span>{method === 'CREDIT_CARD' ? 'Cartão' : method === 'BOLETO' ? 'Boleto' : 'Pix'}</span></label>)}</div>
      <div className="phase4-actions"><button className="phase4-primary" disabled={saving === 'asaas'} onClick={saveAsaas}><Save size={16}/> Salvar Asaas</button><button className="phase4-secondary" disabled={!integration?.asaas.enabled || saving === 'asaas-webhook'} onClick={provisionWebhook}><Webhook size={16}/> Provisionar webhook</button>{integration?.asaas.webhookUrl && <button className="phase4-link" onClick={() => copy(integration.asaas.webhookUrl)}><Copy size={15}/> URL do webhook</button>}</div>
    </section>

    <section className="phase4-card">
      <div className="phase4-card__head"><div><span>Entrega</span><h2>Frete</h2><p>Crie faixas por UF/CEP, valor fixo, prazo e regra de frete grátis.</p></div><Truck size={25}/></div>
      <label className="phase4-toggle"><input type="checkbox" checked={shippingEnabled} onChange={(event) => setShippingEnabled(event.target.checked)}/><span/> Ativar cálculo de frete no checkout</label>
      <div className="phase4-rule-form"><input value={shipping.name} onChange={(e) => setShipping((v) => ({...v,name:e.target.value}))} placeholder="Nome, ex.: Bahia Express"/><input value={shipping.states} onChange={(e) => setShipping((v) => ({...v,states:e.target.value}))} placeholder="UFs: BA,SE"/><input value={shipping.prefixes} onChange={(e) => setShipping((v) => ({...v,prefixes:e.target.value}))} placeholder="Prefixos CEP: 44470,40000"/><input inputMode="decimal" value={shipping.amount} onChange={(e) => setShipping((v) => ({...v,amount:e.target.value}))} placeholder="Valor do frete"/><input inputMode="decimal" value={shipping.freeOver} onChange={(e) => setShipping((v) => ({...v,freeOver:e.target.value}))} placeholder="Grátis acima de"/><input inputMode="numeric" value={shipping.daysMin} onChange={(e) => setShipping((v) => ({...v,daysMin:e.target.value}))} placeholder="Prazo mín."/><input inputMode="numeric" value={shipping.daysMax} onChange={(e) => setShipping((v) => ({...v,daysMax:e.target.value}))} placeholder="Prazo máx."/><button className="phase4-primary" disabled={saving === 'shipping' || !shipping.name.trim()} onClick={addShippingRule}><Plus size={16}/> Criar regra</button></div>
      <div className="phase4-rules">{shippingRules.map((rule) => <article key={rule.id}><PackageCheck size={18}/><div><strong>{rule.name}</strong><span>{rule.states.length ? rule.states.join(', ') : 'Brasil'} · {rule.cepPrefixes.length ? `CEP ${rule.cepPrefixes.join(', ')}` : 'qualquer CEP'} · {money.format(rule.amount)} · {rule.deliveryDaysMin}–{rule.deliveryDaysMax} dias{rule.freeOver != null ? ` · grátis acima de ${money.format(rule.freeOver)}` : ''}</span></div><button disabled={saving === rule.id} onClick={() => deleteShipping(rule)}><Trash2 size={16}/></button></article>)}{!shippingRules.length && <p className="phase4-empty">Nenhuma regra de frete criada.</p>}</div>
    </section>

    <section className="phase4-grid-cards">
      <article className="phase4-card">
        <div className="phase4-card__head"><div><span>Catálogo de produtos</span><h2>Meta Shopping</h2></div><Link2 size={23}/></div>
        <label className="phase4-toggle"><input type="checkbox" checked={metaEnabled} onChange={(event) => setMetaEnabled(event.target.checked)}/><span/> Publicar feed CSV</label>
        <label className="phase4-field"><span>Marca padrão</span><input value={metaBrand} onChange={(event) => setMetaBrand(event.target.value)} placeholder="Nome da marca"/></label>
        {integration?.meta.feedUrl && <div className="phase4-feed-url"><code>{integration.meta.feedUrl}</code><button onClick={() => copy(integration.meta.feedUrl)}><Copy size={14}/></button><a href={integration.meta.feedUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/></a></div>}
      </article>

      <article className="phase4-card">
        <div className="phase4-card__head"><div><span>Integração externa</span><h2>API / ERP</h2></div><KeyRound size={23}/></div>
        <label className="phase4-toggle"><input type="checkbox" checked={erpEnabled} onChange={(event) => setErpEnabled(event.target.checked)}/><span/> Ativar API e webhooks ERP</label>
        <p className="phase4-muted">Tokens usam escopos mínimos e podem ser revogados a qualquer momento. O segredo completo aparece apenas na criação.</p>
      </article>
    </section>

    <div className="phase4-save"><button className="phase4-primary" disabled={saving === 'core'} onClick={saveCore}><Save size={17}/>{saving === 'core' ? 'Salvando…' : 'Salvar frete, Meta e API'}</button></div>

    {erpEnabled && <section className="phase4-card">
      <div className="phase4-card__head"><div><span>Autenticação</span><h2>Tokens da API</h2></div><strong>{apiTokens.filter((item) => item.active).length}</strong></div>
      <div className="phase4-token-form"><input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="Nome do token"/><div className="phase4-scope-grid">{['products:read','orders:read','customers:read','payments:read','stock:write'].map((scope) => <label key={scope}><input type="checkbox" checked={tokenScopes.includes(scope)} onChange={() => toggleScope(scope)}/><span>{scope}</span></label>)}</div><button className="phase4-primary" disabled={saving === 'token' || !tokenScopes.length} onClick={createToken}><KeyRound size={16}/> Gerar token</button></div>
      <div className="phase4-token-list">{apiTokens.map((token) => <article key={token.id}><div><strong>{token.name}</strong><span><code>{token.tokenPrefix}…</code> · {token.scopes.join(', ')}</span></div><button disabled={!token.active || saving === token.id} onClick={() => revokeToken(token)}>{token.active ? 'Revogar' : 'Revogado'}</button></article>)}{!apiTokens.length && <p className="phase4-empty">Nenhum token criado.</p>}</div>
    </section>}

    {erpEnabled && <section className="phase4-card">
      <div className="phase4-card__head"><div><span>Eventos assinados</span><h2>Webhooks ERP</h2><p>O ShopVax envia assinatura HMAC SHA-256 no header <code>x-shopvax-signature</code>.</p></div><Webhook size={24}/></div>
      <div className="phase4-webhook-form"><input value={webhookForm.name} onChange={(e) => setWebhookForm((v) => ({...v,name:e.target.value}))} placeholder="Nome"/><input value={webhookForm.url} onChange={(e) => setWebhookForm((v) => ({...v,url:e.target.value}))} placeholder="https://erp.exemplo.com/webhooks/shopvax"/><button className="phase4-primary" disabled={saving === 'erp-webhook' || !webhookForm.url.trim()} onClick={createErpWebhook}><Plus size={16}/> Adicionar webhook</button></div>
      <div className="phase4-rules">{erpWebhooks.map((webhook) => <article key={webhook.id}><Webhook size={18}/><div><strong>{webhook.name}</strong><span>{webhook.url} · {webhook.events.join(', ')}</span></div><button disabled={saving === webhook.id} onClick={() => deleteErpWebhook(webhook)}><Trash2 size={16}/></button></article>)}{!erpWebhooks.length && <p className="phase4-empty">Nenhum webhook ERP criado.</p>}</div>
    </section>}

    <section className="phase4-card">
      <div className="phase4-card__head"><div><span>Financeiro</span><h2>Cobranças recentes</h2><p>Pagamento confirmado não confirma a venda/comissão automaticamente.</p></div><strong>{paidCount} paga(s)</strong></div>
      <div className="phase4-payments">{recentPayments.slice(0, 12).map((payment) => <article key={payment.id}><div><strong>{money.format(payment.value)}</strong><span>{payment.billing_type} · {payment.status}</span></div>{payment.invoice_url && <a href={payment.invoice_url} target="_blank" rel="noreferrer">Abrir cobrança <ExternalLink size={13}/></a>}</article>)}{!recentPayments.length && <p className="phase4-empty">Nenhuma cobrança criada ainda.</p>}</div>
    </section>
  </div>
}
