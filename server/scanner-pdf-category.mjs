// Categorias inferidas apenas quando o título do PDF identifica a peça.
// Não inventar um tipo específico para títulos ambíguos.
const RULES = [
  ['Pulseiras e braceletes', /^(?:pulseira\s*\/\s*bracelete)\b/],
  ['Brincos', /^(?:brinco|brincos)\b/],
  ['Colares', /^(?:colar|colares|gargantilha|gargantilhas|choker|chokers)\b/],
  ['Pulseiras', /^(?:pulseira|pulseiras|tornozeleira|tornozeleiras)\b/],
  ['Braceletes', /^(?:bracelete|braceletes|bracele|bacelete)\b/],
  ['Broches', /^(?:broche|broches)\b/],
  ['Bolsas', /^(?:bolsa|bolsas)\b/],
  ['Lenços', /^(?:lenco|lencos|pareo|pareos)\b/],
  ['Toucados', /^(?:touca|toca|toucados|gola|golas)\b/],
  ['Presilhas', /^(?:presilha|presilhas)\b/],
  ['Anéis', /^(?:anel|aneis)\b/],
  ['Acessórios', /^(?:tiara|tiaras|presilha|presilhas|lenco|lencos|echarpe|echarpes|cinto|cintos)\b/],
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
