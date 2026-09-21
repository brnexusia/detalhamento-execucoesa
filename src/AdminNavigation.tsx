import { BarChart3, Home, Package, ReceiptText, Settings, Users } from 'lucide-react'

export type PrimaryAdminSection = 'inicio' | 'produtos' | 'pedidos' | 'vendedoras' | 'relatorios' | 'loja'

type Counts = { products?: number; orders?: number; sellers?: number }

type Props = {
  active: PrimaryAdminSection
  counts?: Counts
  planCode?: string
  onNavigate?: () => void
  beforeNavigate?: () => boolean | Promise<boolean>
}

const items = [
  { key: 'inicio', label: 'Início', path: '/painel', icon: Home },
  { key: 'produtos', label: 'Produtos', path: '/painel/produtos', icon: Package, count: 'products' },
  { key: 'pedidos', label: 'Pedidos', path: '/painel/pedidos', icon: ReceiptText, count: 'orders' },
  { key: 'vendedoras', label: 'Vendedoras', path: '/painel/vendedoras', icon: Users, count: 'sellers' },
  { key: 'relatorios', label: 'Inteligência', path: '/painel/relatorios', icon: BarChart3, minPlan: 'prata' },
  { key: 'loja', label: 'Minha loja', path: '/painel/loja', icon: Settings },
] as const

function go(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function hasPlan(planCode: string | undefined, minimum: 'prata') {
  if (!planCode) return true
  return planCode === 'prata' || planCode === 'ouro'
}

export default function AdminNavigation({ active, counts = {}, planCode, onNavigate, beforeNavigate }: Props) {
  return <nav className="panel-nav" aria-label="Navegação do painel">
    {items.filter((item) => !('minPlan' in item) || hasPlan(planCode, item.minPlan)).map((item) => {
      const Icon = item.icon
      const countKey = 'count' in item ? item.count : undefined
      const count = countKey ? counts[countKey] : undefined
      const selected = active === item.key
      return <button
        key={item.key}
        className={selected ? 'is-active' : ''}
        aria-current={selected ? 'page' : undefined}
        onClick={async () => { if (beforeNavigate && await beforeNavigate() === false) return; onNavigate?.(); go(item.path) }}
      >
        <Icon size={18}/><span>{item.label}</span>{typeof count === 'number' && <b>{count}</b>}
      </button>
    })}
  </nav>
}
