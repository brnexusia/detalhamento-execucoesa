// A mesma janela sazonal é aplicada na vitrine, no painel e nos PDFs.
// A regra usa o calendário comercial brasileiro, independentemente do fuso do servidor.
const base = {
  id: 'padrao', name: 'Padrão da loja', label: 'CATÁLOGO DE ATACADO',
  message: 'Escolha suas peças e monte seu pedido.',
  tip: 'Lojista, atualize as fotos e confira o pedido mínimo antes de compartilhar o catálogo.',
  background: '#F3F0E8', surface: '#FCFAF5', ink: '#161514',
  accent: '#F25C05', soft: '#EEE9E0', line: '#D9D3C6',
}
const seasonal = {
  padrao: base,
  'black-friday': {
    id: 'black-friday', name: 'Black Friday', label: 'BLACK FRIDAY',
    message: 'Seu próximo pedido começa por aqui.',
    tip: 'Lojista, confira estoque, preços reais e produtos participantes antes de divulgar sua campanha.',
    background: '#181616', surface: '#FFF8F0', ink: '#211B17',
    accent: '#FF6225', soft: '#FBE5D6', line: '#E5CBBB',
  },
  natal: {
    id: 'natal', name: 'Natal', label: 'TEMPORADA DE NATAL',
    message: 'Escolhas especiais para o fim de ano.',
    tip: 'Lojista, organize uma coleção temática, revise o estoque e divulgue apenas os prazos reais de pedidos e entrega.',
    background: '#12372F', surface: '#FFFAF2', ink: '#19382F',
    accent: '#DBB46B', soft: '#F8EBD3', line: '#E5D6B6',
  },
}
export const seasonalThemeIds = Object.freeze(Object.keys(seasonal))

export function shopvaxBrazilMonth(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric' }).format(now))
}
export function isShopvaxSeasonOpen(id, now = new Date()) {
  const month = shopvaxBrazilMonth(now)
  return id === 'padrao' ||
    (id === 'black-friday' && month === 11) ||
    (id === 'natal' && month === 12)
}
export function resolveShopvaxTheme(store = {}, now = new Date()) {
  const requested = typeof store.seasonal_theme === 'string' && Object.hasOwn(seasonal, store.seasonal_theme)
    ? store.seasonal_theme : 'padrao'
  const id = isShopvaxSeasonOpen(requested, now) ? requested : 'padrao'
  const theme = seasonal[id]
  const accent = /^#[a-f0-9]{6}$/i.test(String(store.accent || '')) ? store.accent : base.accent
  return id === 'padrao' ? { ...theme, accent } : theme
}
