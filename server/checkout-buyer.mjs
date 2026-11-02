export const deliveryMethodLabels = Object.freeze({
  retirada: 'Retirada na loja',
  motoboy: 'Motoboy',
  transportadora: 'Transportadora',
  correios: 'Correios',
  entrega_propria: 'Entrega própria',
  excursao: 'Ônibus de excursão',
  combinar: 'Combinar com a vendedora',
})
const needsAddress = new Set(['motoboy','transportadora','correios','entrega_propria'])
const digits = (value) => String(value ?? '').replace(/\D/g,'')
const text = (value,length) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,length)
export function normalizeCheckoutBuyer(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const buyer = {
    name: text(raw.name,120),phone: digits(raw.phone).slice(0,20),
    email: text(raw.email,160),document: digits(raw.document).slice(0,14),
    cep: digits(raw.cep).slice(0,8),state: text(raw.state,2).toUpperCase(),
    city: text(raw.city,100),neighborhood: text(raw.neighborhood,100),
    street: text(raw.street,180),number: text(raw.number,25),
    complement: text(raw.complement,120),reference: text(raw.reference,180),
    deliveryMethod: text(raw.deliveryMethod,32),
    busPlate: text(raw.busPlate,15),busColor: text(raw.busColor,50),
    busIdentifier: text(raw.busIdentifier,160),
  }
  if (raw.deliveryMethod && !deliveryMethodLabels[buyer.deliveryMethod]) return {error:'Forma de entrega inválida.'}
  if (buyer.phone && buyer.phone.length < 10) return {error:'Informe um telefone válido ou deixe o campo em branco.'}
  if (buyer.cep && buyer.cep.length !== 8) return {error:'O CEP precisa ter 8 dígitos.'}
  if (buyer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) return {error:'Confira o e-mail informado.'}
  if (buyer.document && ![11,14].includes(buyer.document.length)) return {error:'CPF/CNPJ deve ter 11 ou 14 dígitos.'}
  if (buyer.state && !/^[A-Z]{2}$/.test(buyer.state)) return {error:'UF precisa ter duas letras.'}
  if (needsAddress.has(buyer.deliveryMethod) && (!buyer.cep || !buyer.state || !buyer.city || !buyer.neighborhood || !buyer.street || !buyer.number))
    return {error:'Informe CEP, UF, cidade, bairro, rua e número para esta forma de entrega.'}
  if (buyer.deliveryMethod === 'excursao' && (!buyer.busPlate || !buyer.busColor || !buyer.busIdentifier))
    return {error:'Informe placa, cor e identificação do ônibus de excursão.'}
  return {buyer}
}
export function checkoutBuyerRows(buyer = {}) {
  const values = [
    ['Comprador',buyer.name],['Contato',buyer.phone],['E-mail',buyer.email],['CPF/CNPJ',buyer.document],
    ['Entrega',deliveryMethodLabels[buyer.deliveryMethod] || ''],['CEP',buyer.cep],
    ['UF',buyer.state],['Cidade',buyer.city],['Bairro',buyer.neighborhood],
    ['Endereço',buyer.street],['Número',buyer.number],['Complemento',buyer.complement],
    ['Referência',buyer.reference],['Placa do ônibus',buyer.deliveryMethod === 'excursao' ? buyer.busPlate : ''],
    ['Cor do ônibus',buyer.deliveryMethod === 'excursao' ? buyer.busColor : ''],
    ['Ônibus/excursão',buyer.deliveryMethod === 'excursao' ? buyer.busIdentifier : ''],
  ]
  return values.filter(([,value]) => typeof value === 'string' && value.trim())
}
export const checkoutBuyerLines = (buyer) => checkoutBuyerRows(buyer).map(([label,value]) => label + ': ' + value)
