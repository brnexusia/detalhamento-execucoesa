import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

/**
 * Componentes básicos do Shopvax.
 * Fonte visual oficial: Shopvax_ Catálogo (redesign).zip / prancha 02 — Sistema.
 * Os componentes não possuem lógica comercial nem acesso a dados do cliente.
 */
export const SHOPVAX_PALETTES = [
  { id: 'laranja', label: 'Laranja Shopvax', accent: '#F25C05' },
  { id: 'mostarda', label: 'Mostarda', accent: '#E9B21C' },
  { id: 'grafite', label: 'Grafite', accent: '#8A96A1' },
] as const

export const SHOPVAX_DEFAULT_ACCENT = SHOPVAX_PALETTES[0].accent

export function shopvaxPaletteName(accent: string) {
  return SHOPVAX_PALETTES.find((item) => item.accent.toLowerCase() === String(accent || '').toLowerCase())?.label || 'Personalizada'
}

/** Mantém contraste do acento personalizado sem alterar a escolha de cor do lojista. */
export function shopvaxAccentTextColor(accent: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return '#161514'
  const channels = [1, 3, 5].map((offset) => parseInt(accent.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  const paperContrast = (0.871 + 0.05) / (luminance + 0.05)
  const inkContrast = (luminance + 0.05) / (0.0075 + 0.05)
  return paperContrast > inkContrast ? '#F3F0E8' : '#161514'
}

type SVButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'quiet'
  children: ReactNode
}

export function SVButton({ variant = 'primary', className = '', children, ...props }: SVButtonProps) {
  return <button className={`svx-button svx-button--${variant} ${className}`.trim()} {...props}>{children}</button>
}

export function SVRibbon({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`svx-ribbon ${className}`.trim()} {...props}>{children}</div>
}

/** Prancha 08/01 — fita de condições a 40 px/s; mede o trecho para manter velocidade constante. */
export function SVTicker({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  const unitRef = useRef<HTMLSpanElement>(null)
  const [seconds, setSeconds] = useState(18)
  useEffect(() => {
    const unit = unitRef.current
    if (!unit) return
    const update = () => setSeconds(Math.max(5, unit.getBoundingClientRect().width / 40))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(unit)
    return () => observer.disconnect()
  }, [])
  return <div className={`svx-ribbon svx-motion-ticker ${className}`.trim()} {...props}>
    <div className="svx-motion-ticker__track" style={{'--svx-ticker-duration': `${seconds}s`} as React.CSSProperties}>
      <span ref={unitRef} className="svx-motion-ticker__unit">{children}</span>
      <span aria-hidden="true" className="svx-motion-ticker__unit">{children}</span>
    </div>
  </div>
}

export function SVStamp({ children, className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`svx-stamp ${className}`.trim()} {...props}>{children}</span>
}

export function SVTag({ children, kind = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { kind?: 'neutral' | 'price' | 'new' }) {
  return <span className={`svx-tag svx-tag--${kind} ${className}`.trim()} {...props}>{children}</span>
}

export function SVNumber({ value, label, className = '' }: { value: number | string; label: string; className?: string }) {
  return <span className={`svx-number ${className}`.trim()}><strong>{value}</strong><small>{label}</small></span>
}

export function SVBrandSignature({ className = '' }: { className?: string }) {
  return <span className={`svx-signature ${className}`.trim()}>feito com <img className="svx-brand-wordmark" src="/brand/shopvax-wordmark.svg" alt="Shopvax" /></span>
}
