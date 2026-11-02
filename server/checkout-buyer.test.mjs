import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCheckoutBuyer,checkoutBuyerLines } from './checkout-buyer.mjs'
test('normaliza endereço completo e modalidade por ônibus',()=>{
 const result=normalizeCheckoutBuyer({name:' Ana  Souza ',phone:'(71) 99999-1111',email:'ana@example.test',document:'123.456.789-01',cep:'41740-100',state:'ba',city:'Salvador',neighborhood:'Pituba',street:'Rua das Flores',number:'140',deliveryMethod:'excursao',busPlate:'ABC1D23',busColor:'Azul',busIdentifier:'Excursão 09'})
 assert.equal(result.error,undefined)
 assert.equal(result.buyer.phone,'71999991111')
 assert.equal(result.buyer.document,'12345678901')
 assert.equal(result.buyer.cep,'41740100')
 assert.equal(result.buyer.state,'BA')
 assert.match(checkoutBuyerLines(result.buyer).join('\n'),/Ônibus\/excursão: Excursão 09/)
 assert.match(checkoutBuyerLines(result.buyer).join('\n'),/Endereço: Rua das Flores/)
})
test('bloqueia entrega com endereço incompleto',()=>{
 const result=normalizeCheckoutBuyer({deliveryMethod:'motoboy',cep:'41740100',city:'Salvador'})
 assert.match(result.error,/CEP, UF, cidade/)
})
test('exige placa, cor e identificação de excursão',()=>{
 assert.match(normalizeCheckoutBuyer({deliveryMethod:'excursao',busPlate:'ABC1D23'}).error,/placa/)
})
test('preserva pedidos legados sem modalidade e recusa documentos incorretos',()=>{
 assert.deepEqual(normalizeCheckoutBuyer({name:'Cliente'}).buyer.name,'Cliente')
 assert.match(normalizeCheckoutBuyer({document:'1234'}).error,/CPF\/CNPJ/)
 assert.match(normalizeCheckoutBuyer({deliveryMethod:'navio'}).error,/inválida/)
})
