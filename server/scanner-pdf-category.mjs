// Categorias inferidas apenas quando o título do PDF identifica a peça.
// Não inventar um tipo específico para títulos ambíguos.
const RULES = [
  ['Conjuntos', /^(?:conjunto|conjuntos|kit\s+de\s+conjunto)\b/],
  ['Macacões', /^(?:macacao|macacoes)\b/],
  ['Macaquinhos', /^(?:macaquinho|macaquinhos)\b/],
  ['Vestidos', /^(?:vestido|vestidos)\b/],
  ['Calças', /^(?:calca|calcas|pantalona|pantalonas|legging|leggings)\b/],
  ['Blusas', /^(?:blusa|blusas|bata|batas)\b/],
  ['Camisas', /^(?:camisa|camisas)\b/],
  ['Camisetas', /^(?:camiseta|camisetas|t-?shirt|t-?shirts)\b/],
  ['Regatas', /^(?:regata|regatas|regta|regtas)\b/],
  ['Corsets', /^(?:corset|corsets|corselet|corselets)\b/],
  ['Bodies', /^(?:body|bodies)\b/],
  ['Tops', /^(?:top|tops|cropped|croppeds)\b/],
  ['Saias', /^(?:saia|saias)\b/],
  ['Shorts', /^(?:short|shorts)\b/],
  ['Bermudas', /^(?:bermuda|bermudas)\b/],
  ['Jaquetas', /^(?:jaqueta|jaquetas|casaco|casacos)\b/],
  ['Blazers', /^(?:blazer|blazers)\b/],
  ['Coletes', /^(?:colete|coletes)\b/],
]
export function inferPdfProductCategory(title) {
  const name = String(title || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return RULES.find(([, rule]) => rule.test(name))?.[0] || 'Outros'
}
