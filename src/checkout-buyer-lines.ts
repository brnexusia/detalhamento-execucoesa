import type { AdminOrder } from './types'
type Buyer = NonNullable<AdminOrder['buyer']>
const methods: Record<string,string> = {
  retirada:'Retirada na loja',motoboy:'Motoboy',transportadora:'Transportadora',correios:'Correios',
  entrega_propria:'Entrega própria',excursao:'Ônibus de excursão',combinar:'Combinar com a vendedora',
}
export function buyerDetailRows(buyer?: Buyer): Array<[string,string]> {
  if (!buyer) return []
  const values: Array<[string,string | undefined]> = [
    ['Comprador',buyer.name],['Contato',buyer.phone],['E-mail',buyer.email],['CPF/CNPJ',buyer.document],
    ['Entrega',buyer.deliveryMethod ? methods[buyer.deliveryMethod] : undefined],
    ['CEP',buyer.cep],['UF',buyer.state],['Cidade',buyer.city],['Bairro',buyer.neighborhood],
    ['Endereço',buyer.street],['Número',buyer.number],['Complemento',buyer.complement],
    ['Referência',buyer.reference],
    ['Placa do ônibus',buyer.deliveryMethod === 'excursao' ? buyer.busPlate : undefined],
    ['Cor do ônibus',buyer.deliveryMethod === 'excursao' ? buyer.busColor : undefined],
    ['Ônibus/excursão',buyer.deliveryMethod === 'excursao' ? buyer.busIdentifier : undefined],
  ]
  return values.filter((row): row is [string,string] => Boolean(row[1]?.trim()))
}
