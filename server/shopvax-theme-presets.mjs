const base = {
  id: 'padrao', name: 'Padrão da loja', label: 'CATÁLOGO DE ATACADO',
  message: 'Escolha suas peças e monte seu pedido.',
  tip: 'Apresente seus produtos com sua identidade habitual.',
  background: '#F3F0E8', surface: '#FCFAF5', ink: '#161514',
  accent: '#F25C05', soft: '#EEE9E0', line: '#D9D3C6',
}
const seasonal = {
  padrao: base,
  'black-friday': {
    id: 'black-friday', name: 'Black Friday', label: 'BLACK FRIDAY',
    message: 'Seleção especial para a temporada.',
    tip: 'Destaque produtos participantes e confira preços antes de anunciar descontos.',
    background: '#171717', surface: '#FFFAE4', ink: '#171717',
    accent: '#F6C544', soft: '#FFF0B6', line: '#C39D33',
  },
  natal: {
    id: 'natal', name: 'Natal', label: 'COLEÇÃO DE FIM DE ANO',
    message: 'Novidades para celebrar a temporada.',
    tip: 'Organize as coleções de fim de ano e avise sobre os prazos reais de atendimento.',
    background: '#174234', surface: '#FFF7EA', ink: '#143C30',
    accent: '#D95645', soft: '#FBE1D4', line: '#B5C8B8',
  },
  'sao-joao': {
    id: 'sao-joao', name: 'São João', label: 'TEMPORADA DE SÃO JOÃO',
    message: 'Peças para entrar no clima da estação.',
    tip: 'Agrupe peças por cor ou ocasião e compartilhe o catálogo atualizado.',
    background: '#1E3F69', surface: '#FFF8E5', ink: '#20364B',
    accent: '#F2B83C', soft: '#FFF0BE', line: '#C8B789',
  },
}
export const seasonalThemeIds = Object.freeze(Object.keys(seasonal))
export function resolveShopvaxTheme(store = {}) {
  const id = typeof store.seasonal_theme === 'string' && Object.hasOwn(seasonal, store.seasonal_theme)
    ? store.seasonal_theme : 'padrao'
  const theme = seasonal[id]
  const accent = /^#[a-f0-9]{6}$/i.test(String(store.accent || '')) ? store.accent : base.accent
  // A paleta pessoal é a fonte de cor do tema padrão; temas sazonais têm cores próprias.
  return id === 'padrao' ? { ...theme, accent } : theme
}
