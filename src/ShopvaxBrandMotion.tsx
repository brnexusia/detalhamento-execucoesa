import './shopvax-brand-motion.css'

/** Símbolo oficial Shopvax: os DOIS paths originais formam o X.
 * V chega de cima, A chega de baixo; só após o encaixe o conjunto gira 360°.
 * Não há morphing, fonte substituta, troca de imagem ou cruzamento dos caminhos.
 */
export type BrandMotionVariant = 'assemble' | 'mirror' | 'water'
export default function ShopvaxBrandMotion({
  active = false, variant = 'assemble', symbolSrc = '/brand/shopvax-symbol.svg',
}: { active?: boolean; variant?: BrandMotionVariant; symbolSrc?: string }) {
  const onDark = symbolSrc.includes('dark') || symbolSrc === '/brand/shopvax-symbol.svg'
  return <span
    className={'svx-brand-motion' + (active ? ' is-animating' : '') + (onDark ? ' svx-brand-motion--dark' : '')}
    data-brand-motion="assemble" aria-hidden="true">
    <svg className="svx-brand-motion__symbol svx-brand-symbol"
      viewBox="370 300 220 282" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <g className="svx-brand-motion__assembly">
        <path className="svx-brand-motion__v" d="M370 300H430.893L480 403.321L529.107 300H590L511.429 430.821H448.571L370 300Z"/>
        <path className="svx-brand-motion__a" d="M370 581.286H430.893L480 477.964L529.107 581.286H590L511.429 450.464H448.571L370 581.286Z"/>
      </g>
    </svg>
  </span>
}
