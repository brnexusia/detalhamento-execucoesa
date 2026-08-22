import type { PublicPayload } from './types'

export const demoPayload: PublicPayload = {
  store: {
    slug: 'casa-norte',
    name: 'Casa Norte',
    eyebrow: 'Atacado de moda e acessórios',
    tagline: 'Peças que giram. Pedido sem enrolação.',
    minimumOrder: 400,
    whatsapp: '5571999999999',
    accent: '#c94c2d',
  },
  seller: { slug: 'marina', name: 'Marina', phone: '5571999999999' },
  products: [
    { id: 'p1', sku: 'CN-0182', name: 'Bolsa Estruturada Siena', description: 'Bolsa média com alça regulável e ferragens foscas.', price: 48.9, category: 'Bolsas', pack: 'Kit com 3 cores', mediaUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', featured: true, variations: [{ name: 'Cor', options: ['Preto', 'Caramelo', 'Off white'] }] },
    { id: 'p2', sku: 'CN-0311', name: 'Camisa Ampla Linho', description: 'Modelagem ampla, toque leve e acabamento limpo.', price: 42, category: 'Roupas', pack: 'Grade P/M/G', mediaUrl: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', variations: [{ name: 'Cor', options: ['Areia', 'Branco', 'Preto'] }, { name: 'Tamanho', options: ['P', 'M', 'G'] }] },
    { id: 'p3', sku: 'CN-0290', name: 'Óculos Bossa', description: 'Armação leve com lente escura e proteção UV400.', price: 21.5, category: 'Acessórios', pack: 'Mínimo 6 un.', mediaUrl: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', variations: [{ name: 'Cor', options: ['Tartaruga', 'Preto'] }] },
    { id: 'p4', sku: 'CN-0412', name: 'Vestido Midi Flora', description: 'Midi fluido, alça larga e recorte reto nas costas.', price: 59.9, category: 'Roupas', pack: 'Grade P/M/G', mediaUrl: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', featured: true, variations: [{ name: 'Cor', options: ['Terracota', 'Azul'] }, { name: 'Tamanho', options: ['P', 'M', 'G'] }] },
    { id: 'p5', sku: 'CN-0504', name: 'Carteira Compacta Leme', description: 'Formato compacto com fechamento por botão e seis divisórias.', price: 16.9, category: 'Carteiras', pack: 'Kit com 5 un.', mediaUrl: 'https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', variations: [{ name: 'Cor', options: ['Preto', 'Vinho', 'Caramelo'] }] },
    { id: 'p6', sku: 'CN-0607', name: 'Tênis Casual Rua', description: 'Solado baixo, construção leve e palmilha macia.', price: 54, category: 'Calçados', pack: 'Grade 34 ao 39', mediaUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=88', mediaType: 'image', variations: [{ name: 'Cor', options: ['Branco', 'Preto'] }, { name: 'Tamanho', options: ['34', '35', '36', '37', '38', '39'] }] },
  ],
}
