import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Search, Users, ReceiptText, CalendarDays, ShoppingBag, X, RefreshCw } from 'lucide-react'
import { apiRequest } from './api'
import './platform-buyers.css'

type BuyerSource = 'global' | 'legacy'
type BuyerRow = {
  source: BuyerSource; id: string; name: string; email: string; phone: string; createdAt: string
  profileCompleted: boolean; marketingConsent: boolean | null; originName: string | null
  ordersCount: number; validOrders: number; ordersValue: number; lastOrderAt: string | null; storesCount: number
}
type Coverage = { buyers: boolean; customers: boolean; origins: boolean; consents: boolean; linkedBuyers: boolean; orderCustomers: boolean }
type Page = { buyers: BuyerRow[]; total: number; limit: number; offset: number; coverage: Coverage }
type BuyerProfile = BuyerRow & {
  city: string; state: string; purpose: string; businessStatus: string; businessName: string
  cnpj: string; cnpjStatus: string; segment: string; instagram: string; channels: string[]
}
type StoreLink = {
  id: string; name: string; slug: string; linkedAt: string
  ordersCount: number; ordersValue: number; lastOrderAt: string | null
  promoWhatsapp: boolean; promoEmail: boolean
}
type BuyerOrder = { id: string; code: string; status: string; total: number; createdAt: string; storeName: string; storeSlug: string }
type BuyerDetail = {
  profile: BuyerProfile; stores: StoreLink[]; orders: BuyerOrder[]
  summary: {
    ordersCount: number; validOrders: number; cancelledOrders: number; ordersValue: number; averageTicket: number
    firstOrderAt: string | null; lastOrderAt: string | null; last30Days: number; last90Days: number
    storesCount: number; averageDaysBetweenOrders: number | null
  }
  coverage: Coverage; semantics: string
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const int = new Intl.NumberFormat('pt-BR')
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const formatted = (value?: string | null, detailed = false) =>
  value && Number.isFinite(new Date(value).getTime()) ? (detailed ? dateTime : date).format(new Date(value)) : '—'

function orderStatus(status: string) {
  return ({
    whatsapp: 'Preparado para WhatsApp',
    em_atendimento: 'Em atendimento',
    confirmado: 'Confirmado manualmente',
    cancelled: 'Cancelado',
    arquivado: 'Arquivado',
  } as Record<string, string>)[status] || status
}

function identityLabel(value: string) {
  return ({
    revenda: 'Revenda',
    negocio: 'Empresa ou negócio',
    pessoal: 'Uso pessoal',
    ambos: 'Revenda e uso pessoal',
    futuro: 'Iniciando revenda',
  } as Record<string, string>)[value] || value || 'Não informado'
}

function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="pb-info"><small>{label}</small><strong>{value == null || value === '' ? 'Não informado' : value}</strong></div>
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="pb-metric"><small>{label}</small><strong>{value}</strong><span>{note}</span></article>
}

function BuyerDetails({ detail, onClose }: { detail: BuyerDetail; onClose: () => void }) {
  const p = detail.profile
  const s = detail.summary
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return <div className="pb-detail-layer" role="presentation">
    <button type="button" className="pb-detail-backdrop" onClick={onClose} aria-label="Fechar perfil"/>
    <section className="pb-detail" role="dialog" aria-modal="true" aria-label={'Perfil de ' + (p.name || 'comprador')}>
      <header className="pb-detail-head">
        <div><small>Perfil de comprador · {p.source === 'global' ? 'Cadastro global' : 'Cadastro legado'}</small><h2>{p.name || 'Cadastro ainda incompleto'}</h2>
          <p>{p.profileCompleted ? 'Perfil cadastrado' : 'Perfil ainda não concluído'} · Cadastro em {formatted(p.createdAt)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar"><X size={20}/></button>
      </header>
      <div className="pb-detail-body">
        <section className="pb-metrics" aria-label="Resumo dos pedidos">
          <Metric label="Pedidos registrados" value={int.format(s.ordersCount)} note={s.cancelledOrders === 1 ? '1 cancelado' : s.cancelledOrders + ' cancelados'} />
          <Metric label="Valor dos pedidos" value={money.format(s.ordersValue)} note="Exclui cancelados; não é faturamento" />
          <Metric label="Ticket médio" value={money.format(s.averageTicket)} note="Média dos pedidos não cancelados" />
          <Metric label="Contas vinculadas" value={int.format(s.storesCount)} note="Associações identificadas" />
          <Metric label="Últimos 30 dias" value={int.format(s.last30Days)} note={s.last90Days + ' pedidos nos últimos 90 dias'} />
          <Metric label="Intervalo médio" value={s.averageDaysBetweenOrders == null ? '—' : s.averageDaysBetweenOrders.toLocaleString('pt-BR') + ' dias'} note="Entre pedidos não cancelados" />
        </section>
        <p className="pb-note">Primeiro pedido: {formatted(s.firstOrderAt)} · Último pedido: {formatted(s.lastOrderAt)}. Só pedidos com cadastro efetivamente vinculado são contabilizados. Os valores não comprovam pagamento ou venda.</p>
        <section className="pb-section"><h3>Informações pessoais e comerciais</h3>
          <div className="pb-info-grid">
            <Info label="Nome" value={p.name}/><Info label="WhatsApp" value={p.phone}/><Info label="E-mail" value={p.email}/>
            <Info label="Cidade / UF" value={[p.city, p.state].filter(Boolean).join(' / ')}/>
            <Info label="Finalidade de compra" value={identityLabel(p.purpose)}/>
            <Info label="Nome do negócio" value={p.businessName}/><Info label="Situação do negócio" value={p.businessStatus}/>
            <Info label="CNPJ" value={p.cnpj}/><Info label="Segmento" value={p.segment}/>
            <Info label="Instagram" value={p.instagram}/>
            <Info label="Canais comerciais" value={Array.isArray(p.channels) ? p.channels.join(', ') : ''}/>
            <Info label="Origem registrada" value={p.originName || 'Origem não identificada'}/>
            <Info label="Promoções gerais" value={p.marketingConsent == null ? 'Sem registro global' : p.marketingConsent ? 'Aceitou' : 'Não aceitou'}/>
          </div>
        </section>
        <section className="pb-section"><h3>Contas comerciais relacionadas <span>({detail.stores.length})</span></h3>
          {detail.stores.length === 0 ? <p className="pb-note">Nenhuma vinculação comercial identificada. Apenas visitar uma vitrine não cria vínculo automaticamente.</p> :
          <div className="pb-store-list">{detail.stores.map((item) => <article key={item.id}>
            <div><strong>{item.name}</strong><small>Desde {formatted(item.linkedAt)} · {item.ordersCount === 1 ? '1 pedido' : item.ordersCount + ' pedidos'}</small>
              <small>Promoções: {item.promoWhatsapp ? 'WhatsApp autorizado' : 'WhatsApp não autorizado'} · {item.promoEmail ? 'E-mail autorizado' : 'E-mail não autorizado'}</small>
            </div><div><strong>{money.format(item.ordersValue)}</strong><small>Último pedido: {formatted(item.lastOrderAt)}</small>
              <a href={'/' + item.slug} target="_blank" rel="noreferrer">Ver vitrine</a>
            </div>
          </article>)}</div>}
        </section>
        <section className="pb-section"><h3>Histórico de pedidos <span>(últimos 100)</span></h3>
          {detail.orders.length === 0 ? <p className="pb-note">Nenhum pedido identificado para esse cadastro.</p> :
          <div className="pb-table-scroller"><table className="pb-table"><thead><tr><th>Pedido</th><th>Conta comercial</th><th>Data</th><th>Status</th><th>Valor</th></tr></thead>
            <tbody>{detail.orders.map((order) => <tr key={order.id}><td>{order.code}</td><td>{order.storeName}</td>
              <td>{formatted(order.createdAt, true)}</td><td>{orderStatus(order.status)}</td><td>{money.format(order.total)}</td></tr>)}</tbody>
          </table></div>}
        </section>
        {(!detail.coverage.orderCustomers || !detail.coverage.customers) &&
          <p className="pb-warning">O esquema de vinculação de compradores a pedidos ainda não está disponível. As métricas de pedidos podem estar incompletas.</p>}
      </div>
    </section>
  </div>
}

export default function PlatformBuyerDirectory() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ source: BuyerSource; id: string } | null>(null)
  const [detail, setDetail] = useState<BuyerDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ q: search, source, limit: '25', offset: String(page * 25) })
    apiRequest<Page>('/api/platform/buyers?' + params.toString())
      .then((result) => { if (active) setData(result) })
      .catch((err) => { if (active) { setData(null); setError(err instanceof Error ? err.message : 'Não foi possível consultar os compradores.') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, source, page, refresh])

  useEffect(() => {
    if (!selected) return
    let active = true
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    apiRequest<BuyerDetail>('/api/platform/buyers/' + selected.source + '/' + encodeURIComponent(selected.id))
      .then((result) => { if (active) setDetail(result) })
      .catch((err) => { if (active) setDetailError(err instanceof Error ? err.message : 'Não foi possível carregar o perfil.') })
      .finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selected])

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / 25))
  return <div className="platform-page pb-page">
    <div className="pb-heading"><div><span>Base de pessoas</span><h1>Compradores</h1>
      <p>Todos os cadastros globais e antigos de compradores, com histórico real de pedidos e contas comerciais relacionadas.</p></div>
      <button className="platform-secondary" type="button" disabled={loading} onClick={() => setRefresh((x) => x + 1)}><RefreshCw size={16}/> Atualizar</button>
    </div>
    <div className="pb-top-metrics"><Metric label="Compradores encontrados" value={data ? int.format(data.total) : '—'} note="Dentro do filtro selecionado"/><Metric label="Registros exibidos" value={data ? int.format(data.buyers.length) : '—'} note="Paginação de até 25 pessoas"/></div>
    <form className="pb-filters" onSubmit={(e) => { e.preventDefault(); setPage(0); setSearch(query.trim()) }}>
      <label className="pb-search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar compradores"/></label>
      <select value={source} aria-label="Tipo de cadastro" onChange={(e) => { setSource(e.target.value); setPage(0) }}>
        <option value="all">Todos os compradores</option><option value="global">Cadastro global WhatsApp</option><option value="legacy">Cadastro antigo por conta</option>
      </select>
      <button type="submit" className="platform-primary">Buscar</button>
    </form>
    <p className="pb-note">Um comprador global pode aparecer em várias contas comerciais, mas será contado apenas uma vez. Cadastros antigos sem vínculo global permanecem separados para evitar associações incorretas.</p>
    {error && <p className="pb-warning" role="alert">{error}</p>}
    {loading && <p role="status" className="pb-note">Consultando cadastros…</p>}
    {!loading && data && <>
      {(!data.coverage.buyers || !data.coverage.customers || !data.coverage.orderCustomers) &&
        <p className="pb-warning">Parte da base ainda não está inicializada; o histórico exibido pode ser parcial. Não são gerados dados fictícios.</p>}
      <div className="pb-list" aria-label="Lista de compradores">
        {data.buyers.map((buyer) => <button type="button" key={buyer.source + ':' + buyer.id}
          className="pb-list-row" onClick={() => setSelected({ source: buyer.source, id: buyer.id })}>
          <span className="pb-avatar"><Users size={19}/></span>
          <span className="pb-list-identity"><strong>{buyer.name || 'Cadastro incompleto'}</strong>
            <small>{buyer.phone || buyer.email || 'Sem contato preenchido'} · {buyer.source === 'global' ? 'Global' : 'Antigo'}</small>
            <small>{buyer.originName ? 'Origem: ' + buyer.originName : 'Origem não identificada'} · desde {formatted(buyer.createdAt)}</small></span>
          <span className="pb-list-fact"><ReceiptText size={15}/><strong>{int.format(buyer.ordersCount)}</strong><small>pedidos</small></span>
          <span className="pb-list-fact"><ShoppingBag size={15}/><strong>{money.format(buyer.ordersValue)}</strong><small>valor de pedidos</small></span>
          <span className="pb-list-fact"><CalendarDays size={15}/><strong>{formatted(buyer.lastOrderAt)}</strong><small>último pedido</small></span>
          <span className="pb-list-fact"><strong>{buyer.storesCount}</strong><small>contas vinculadas</small></span>
          <ArrowRight size={17} aria-hidden="true"/>
        </button>)}
      </div>
      {data.buyers.length === 0 && <p className="pb-empty">Nenhum comprador encontrado para esta busca.</p>}
      <div className="pb-pages"><span>Página {page + 1} de {totalPages} · {int.format(data.total)} cadastros</span>
        <div><button type="button" className="platform-secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ArrowLeft size={15}/> Anterior</button>
          <button type="button" className="platform-secondary" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>Próxima <ArrowRight size={15}/></button></div>
      </div>
    </>}
    {selected && (detailLoading || detailError) && <div className="pb-detail-layer" role="presentation">
      <button type="button" className="pb-detail-backdrop" aria-label="Fechar perfil" onClick={() => setSelected(null)}/>
      <section className="pb-detail pb-detail-loading" role="dialog" aria-modal="true" aria-label="Carregando perfil">
        <button type="button" onClick={() => setSelected(null)}><X size={18}/> Fechar</button>
        <p role="status">{detailLoading ? 'Carregando histórico do comprador…' : detailError}</p>
      </section>
    </div>}
    {selected && detail && <BuyerDetails detail={detail} onClose={() => setSelected(null)}/>}
  </div>
}
