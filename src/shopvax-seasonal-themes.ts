// As campanhas são exibidas apenas no mês correspondente, em horário do Brasil.
// O visual padrão nunca desaparece e os preços/estoques não são modificados.
export type ShopvaxSeasonalThemeId = 'padrao' | 'black-friday' | 'natal'
export type ShopvaxSeasonalTheme = {
  id: ShopvaxSeasonalThemeId
  name: string
  headline: string
  message: string
  tip: string
  background: string
  surface: string
  ink: string
  accent: string
  decoration: string
  period: string
}

export const SHOPVAX_DEFAULT_THEME: ShopvaxSeasonalTheme = {
  id: 'padrao', name: 'Identidade da loja',
  headline: 'SUA COLEÇÃO, DO SEU JEITO',
  message: 'Escolha suas peças e monte seu pedido.',
  tip: 'Lojista, escolha uma cor que combine com sua marca, mantenha as fotos dos produtos atualizadas e confira seu pedido mínimo antes de compartilhar o catálogo.',
  background: '#F3F0E8', surface: '#FCFAF5', ink: '#161514', accent: '#F25C05',
  decoration: 'CATÁLOGO · GRADE · TALÃO', period: 'Disponível o ano inteiro',
}

export const SHOPVAX_SEASONAL_THEMES: ShopvaxSeasonalTheme[] = [
  {
    id: 'black-friday', name: 'Black Friday', headline: 'BLACK FRIDAY',
    message: 'Seu próximo pedido começa por aqui.',
    tip: 'Lojista, revise os preços e o estoque de cada item participante, organize uma coleção de destaque e só anuncie descontos que realmente cadastrou. Compartilhe o link da sua vendedora com antecedência.',
    background: '#181616', surface: '#FFF8F0', ink: '#211B17', accent: '#FF6225',
    decoration: 'BLACK FRIDAY · SUA VITRINE EM DESTAQUE', period: '1º a 30 de novembro',
  },
  {
    id: 'natal', name: 'Natal', headline: 'TEMPORADA DE NATAL',
    message: 'Escolhas especiais para o fim de ano.',
    tip: 'Lojista, agrupe os produtos de maior procura em uma coleção de Natal, atualize o estoque e informe aos clientes os prazos reais para fazer pedidos e receber as peças.',
    background: '#12372F', surface: '#FFFAF2', ink: '#19382F', accent: '#DBB46B',
    decoration: 'NATAL · ESCOLHAS DE FIM DE ANO', period: '1º a 31 de dezembro',
  },
]

export function shopvaxMonthInBrazil(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric' }).format(now))
}

export function availableSeasonalThemes(now: Date = new Date()): ShopvaxSeasonalTheme[] {
  const month = shopvaxMonthInBrazil(now)
  return SHOPVAX_SEASONAL_THEMES.filter(theme =>
    (theme.id === 'black-friday' && month === 11) ||
    (theme.id === 'natal' && month === 12),
  )
}

export function seasonalThemeById(id: string | undefined, now: Date = new Date()): ShopvaxSeasonalTheme {
  return availableSeasonalThemes(now).find(item => item.id === id) || SHOPVAX_DEFAULT_THEME
}
