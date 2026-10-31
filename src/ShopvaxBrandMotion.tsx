import './shopvax-brand-motion.css'

/** C06: três alternativas leves. A composição V + A -> X é a opção padrão;
 * o X final é sempre o SVG vetorial original aprovado, não um símbolo recriado.
 * O componente é puramente decorativo para evitar anúncios repetitivos no leitor de tela.
 */
export type BrandMotionVariant = 'assemble' | 'mirror' | 'water'
export default function ShopvaxBrandMotion({
  active = false, variant = 'assemble', symbolSrc = '/brand/shopvax-symbol.svg',
}: { active?: boolean; variant?: BrandMotionVariant; symbolSrc?: string }) {
  return <span className={`svx-brand-motion svx-brand-motion--${variant} ${active ? 'is-animating' : ''}`.trim()}
      aria-hidden="true" data-brand-motion={variant}>
    <span className="svx-brand-motion__v">V</span>
    <span className="svx-brand-motion__a">A</span>
    <span className="svx-brand-motion__ring" />
    <img className="svx-brand-motion__symbol svx-brand-symbol" src={symbolSrc} alt="" draggable={false} />
  </span>
}
