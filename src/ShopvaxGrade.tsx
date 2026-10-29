import { useMemo, useState } from 'react'
import { Minus, Plus, ShoppingBag } from 'lucide-react'
import type { Product } from './types'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export type GradeLine = { selections: Record<string, string>; quantity: number }

/** Multi-colour wholesale grade; emits one validated order line per SKU variation. */
export function getGradeGroups(product: Product) {
  const color = product.variations.find((group) => /^(cor|cores|color)$/i.test(group.name.trim()))
  const size = product.variations.find((group) => /^(tamanho|tamanhos|size)$/i.test(group.name.trim()))
  return color && size && product.variations.length === 2 ? { color, size } : null
}

export function stockForVariant(product: Product, selections: Record<string, string>) {
  if (!product.stockEnabled) return Number.POSITIVE_INFINITY
  const key = Object.entries(selections).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([name, value]) => `${name}=${value}`).join('|')
  if (key && product.variantStock && Object.hasOwn(product.variantStock, key)) return Math.max(0, Number(product.variantStock[key]) || 0)
  return Math.max(0, Number(product.stockQuantity) || 0)
}

export function ProductGrade({ product, onAdd, onError }: {
  product: Product
  onAdd: (lines: GradeLine[]) => void
  onError?: (message: string) => void
}) {
  const groups = getGradeGroups(product)
  const [amounts, setAmounts] = useState<Record<string, number>>({})
  const [activeColors, setActiveColors] = useState<string[]>([])
  const columns = groups?.color.options || []
  const rows = groups?.size.options || []
  const active = activeColors.filter((color) => columns.includes(color))
  const lines = useMemo(() => {
    if (!groups) return []
    return active.flatMap((color) => rows.flatMap((size) => {
      const selections = { [groups.color.name]: color, [groups.size.name]: size }
      const quantity = Math.min(999, Math.max(0, amounts[`${color}\u001f${size}`] || 0))
      return quantity ? [{ selections, quantity }] : []
    }))
  }, [activeColors, amounts, groups, rows])
  if (!groups) return null
  const totalQty = lines.reduce((n, item) => n + item.quantity, 0)
  const subtotal = totalQty * product.price
  const update = (color: string, size: string, delta: number) => {
    const key = `${color}\u001f${size}`
    const selections = { [groups.color.name]: color, [groups.size.name]: size }
    const allowed = Math.min(999, stockForVariant(product, selections))
    const previous = amounts[key] || 0
    if (delta > 0 && previous >= allowed) {
      onError?.(allowed === 0 ? 'Essa variação está sem estoque.' : `Disponíveis: ${allowed} peça(s) nessa variação.`)
      return
    }
    onError?.('')
    setAmounts((current) => ({ ...current, [key]: Math.max(0, Math.min(allowed, previous + delta)) }))
  }
  const toggleColor = (color: string) => {
    onError?.('')
    if (active.includes(color)) {
      setActiveColors((current) => current.filter((item) => item !== color))
      setAmounts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(color + '\u001f'))))
    } else setActiveColors((current) => [...current, color])
  }
  return <div className="svx-grade" aria-label="Montar grade por cor e tamanho">
    <div className="svx-grade__head"><div><span className="svx-kicker">ESCOLHA AS CORES · DISTRIBUA AS PEÇAS</span><h3>Monte a grade</h3></div><button type="button" className="svx-grade__clear" onClick={() => { setActiveColors([]); setAmounts({}); onError?.('') }}>Limpar</button></div>
    <div className="svx-grade__colors">{columns.map((color) => <button type="button" key={color} aria-pressed={active.includes(color)} className={active.includes(color) ? 'is-selected' : ''} onClick={() => toggleColor(color)}><span aria-hidden="true">{active.includes(color) ? '■' : '□'}</span> {color}</button>)}</div>
    {!active.length ? <p className="svx-grade__hint">Escolha uma ou mais cores para distribuir as quantidades por tamanho.</p> : <div className="svx-grade__table-scroll"><table className="svx-grade__table"><thead><tr><th scope="col">Tamanho</th>{active.map((color) => <th scope="col" key={color}>{color}</th>)}</tr></thead><tbody>{rows.map((size) => <tr key={size}><th scope="row">{size}</th>{active.map((color) => {
      const value = amounts[`${color}\u001f${size}`] || 0
      const available = stockForVariant(product, { [groups.color.name]: color, [groups.size.name]: size })
      return <td key={color}><div className="svx-grade__stepper"><button type="button" onClick={() => update(color, size, -1)} disabled={value <= 0} aria-label={`Diminuir ${size} na cor ${color}`}><Minus size={14}/></button><output aria-label={`${size} ${color}`}><span className="svx-motion-count" key={value}>{value}</span></output><button type="button" onClick={() => update(color, size, 1)} disabled={value >= available} aria-label={`Aumentar ${size} na cor ${color}`}><Plus size={14}/></button></div></td>
    })}</tr>)}</tbody></table></div>}
    <div className="svx-grade__summary"><span>{totalQty} {totalQty === 1 ? 'PEÇA' : 'PEÇAS'} · {active.length} {active.length === 1 ? 'COR' : 'CORES'}</span><strong>{currency.format(subtotal)}</strong></div>
    <button type="button" className="svx-grade__add" disabled={!totalQty} onClick={() => onAdd(lines)}><ShoppingBag size={17}/> Pôr no pedido <span>{currency.format(subtotal)}</span></button>
  </div>
}
