export type ShopvaxSeasonalThemeId = 'padrao' | 'black-friday' | 'natal' | 'sao-joao'
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
}
export const SHOPVAX_SEASONAL_THEMES: ShopvaxSeasonalTheme[] = [
  {
    id: 'padrao', name: 'Original da loja',
    headline: 'SUA COLEÇÃO, DO SEU JEITO',
    message: 'Escolha suas peças e monte seu pedido.',
    tip: 'Ideal para manter a mesma identidade durante o ano inteiro.',
    background: '#F3F0E8', surface: '#FCFAF5', ink: '#161514', accent: '#F25C05',
    decoration: 'CATÁLOGO · GRADE · TALÃO',
  },
  {
    id: 'black-friday', name: 'Black Friday',
    headline: 'BLACK FRIDAY',
    message: 'Seleção especial para a temporada.',
    tip: 'Destaque os produtos participantes e confira os preços antes de divulgar descontos.',
    background: '#171717', surface: '#FFFAE4', ink: '#171717', accent: '#F6C544',
    decoration: 'BLACK FRIDAY · ESCOLHAS DA ESTAÇÃO',
  },
  {
    id: 'natal', name: 'Natal',
    headline: 'COLEÇÃO DE FIM DE ANO',
    message: 'Novidades para celebrar a temporada.',
    tip: 'Organize coleções temáticas e informe somente prazos de entrega reais.',
    background: '#174234', surface: '#FFF7EA', ink: '#143C30', accent: '#D95645',
    decoration: 'NATAL · COLEÇÃO ESPECIAL',
  },
  {
    id: 'sao-joao', name: 'São João',
    headline: 'TEMPORADA DE SÃO JOÃO',
    message: 'Peças para entrar no clima da estação.',
    tip: 'Agrupe as peças por ocasião e compartilhe o catálogo atualizado.',
    background: '#1E3F69', surface: '#FFF8E5', ink: '#20364B', accent: '#F2B83C',
    decoration: 'SÃO JOÃO · VIVA A TEMPORADA',
  },
]

export function seasonalThemeById(id: string | undefined): ShopvaxSeasonalTheme {
  return SHOPVAX_SEASONAL_THEMES.find(item => item.id === id) || SHOPVAX_SEASONAL_THEMES[0]
}
