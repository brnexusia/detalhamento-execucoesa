import './shopvax-brand-motion.css'

/** Símbolo oficial Shopvax: os DOIS paths originais formam o X.
 * V chega de cima, A chega de baixo; só após o encaixe o conjunto gira 360°.
 * Não há morphing, fonte substituta, troca de imagem ou cruzamento dos caminhos.
 */
export type BrandMotionVariant = 'assemble' | 'mirror' | 'water' | 'spin'
export default function ShopvaxBrandMotion({
  active = false, exit = false, variant = 'assemble', symbolSrc = '/brand/shopvax-symbol.svg',
}: { active?: boolean; exit?: boolean; variant?: BrandMotionVariant; symbolSrc?: string }) {
  const onDark = symbolSrc.includes('dark')
  return <span
    className={'svx-brand-motion' + (active ? ' is-animating' : '') + (onDark ? ' svx-brand-motion--dark' : '') + (exit ? ' svx-brand-motion--exit' : '') + (variant === 'spin' ? ' svx-brand-motion--spin' : '')}
    data-brand-motion={variant} aria-hidden="true">
    {/* O rotor é um elemento HTML com caixa fixa, não um grupo SVG deslocado.
        Assim, rotate() usa o centro físico do X e nunca pode criar uma órbita. */}
    <span className="svx-brand-motion__rotor">
      <svg className="svx-brand-motion__symbol svx-brand-symbol"
        viewBox="370 300 220 282" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <g className="svx-brand-motion__assembly">
          <path className="svx-brand-motion__v" d="M370 300H430.893L480 403.321L529.107 300H590L511.429 430.821H448.571L370 300Z"/>
          <path className="svx-brand-motion__a" d="M370 581.286H430.893L480 477.964L529.107 581.286H590L511.429 450.464H448.571L370 581.286Z"/>
        </g>
      </svg>
    </span>
  </span>
}
